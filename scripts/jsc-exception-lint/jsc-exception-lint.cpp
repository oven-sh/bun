// jsc-exception-lint: a clang LibTooling checker for JavaScriptCore exception
// discipline in Bun's C++ bindings.
//
// JSC's debug-only validator (BUN_JSC_validateExceptionChecks=1) works like
// this: every function that can throw declares a ThrowScope. When a callee's
// ThrowScope is destroyed it "simulates a throw" by setting
// VM::m_needExceptionCheck. The next ThrowScope constructor, and the next
// non-released ThrowScope destructor, assert that the bit is clear. The bit is
// cleared by ExceptionScope::exception() (RETURN_IF_EXCEPTION and friends
// expand to that), VM::clearException(), and the assertNoException family.
//
// This tool models the same state machine statically over the clang CFG of
// every function defined in Bun's bindings. Per function it tracks a set of
// abstract states {clean, pending, thrown} x {released}. A call to a callee
// that may throw moves the state to `pending`. A call to a thrower (throw*,
// Bun::ERR::*) moves it to `thrown`. A check moves it to `clean`. An error is
// reported when:
//   - a may-throw callee is called while the state is `pending`
//     ("call while an exception check is pending"),
//   - a may-throw callee is called while the state is `thrown`
//     ("call after throwing"),
//   - a ThrowScope is constructed or destroyed (not released) while `pending`
//     ("function exits with an unchecked exception").
//
// Whether a callee may throw is decided from its definition when it is visible
// in the translation unit (inline functions, templates, same-file helpers,
// lambdas): a visible body that constructs a ThrowScope, or calls something
// that may throw, may throw. For callees defined in another translation unit,
// summaries exported by a previous run over the whole project are consulted
// (--export-summaries / --import-summaries). For everything else the JSC
// convention applies: a parameter of type JSGlobalObject* (or a subclass), or
// ThrowScope&, means it may throw, unless the qualified name is listed in the
// nothrow allowlist passed with --nothrow=<file>.
//
// Build and run through scripts/jsc-exception-lint/run.ts.

#include "clang/AST/ASTConsumer.h"
#include "clang/AST/ASTContext.h"
#include "clang/AST/Decl.h"
#include "clang/AST/DeclCXX.h"
#include "clang/AST/Expr.h"
#include "clang/AST/ExprCXX.h"
#include "clang/AST/GlobalDecl.h"
#include "clang/AST/Mangle.h"
#include "clang/AST/RecursiveASTVisitor.h"
#include "clang/Analysis/CFG.h"
#include "clang/Basic/SourceManager.h"
#include "clang/Frontend/CompilerInstance.h"
#include "clang/Frontend/FrontendAction.h"
#include "clang/Lex/Lexer.h"
#include "clang/Tooling/CommonOptionsParser.h"
#include "clang/Tooling/Tooling.h"
#include "llvm/Support/CommandLine.h"
#include "llvm/Support/raw_ostream.h"

#include <fstream>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

using namespace clang;
using namespace clang::tooling;

static llvm::cl::OptionCategory Category("jsc-exception-lint options");
static llvm::cl::opt<std::string>
    NothrowFile("nothrow",
                llvm::cl::desc("file with one qualified function name per line "
                               "that is known not to throw"),
                llvm::cl::cat(Category));
static llvm::cl::opt<std::string>
    ThrowFile("maythrow",
              llvm::cl::desc("file with one qualified function name per line "
                             "that is known to throw"),
              llvm::cl::cat(Category));
static llvm::cl::opt<std::string>
    OnlyPathPrefix("only-under",
                   llvm::cl::desc("only report functions defined in files "
                                  "whose path contains this string"),
                   llvm::cl::init("src/jsc/bindings"), llvm::cl::cat(Category));
static llvm::cl::opt<std::string> ExportSummaries(
    "export-summaries",
    llvm::cl::desc("write callee summaries for functions defined in files "
                   "matching --export-under to this file"),
    llvm::cl::cat(Category));
static llvm::cl::list<std::string> ExportUnder(
    "export-under",
    llvm::cl::desc("path prefix that selects functions to export (repeatable, "
                   "required with --export-summaries)"),
    llvm::cl::cat(Category));
static llvm::cl::list<std::string> ImportSummaries(
    "import-summaries",
    llvm::cl::desc("read callee summaries from this file (repeatable)"),
    llvm::cl::cat(Category));
static llvm::cl::opt<bool>
    JsonOutput("json", llvm::cl::desc("emit one JSON object per line"),
               llvm::cl::cat(Category));
static llvm::cl::opt<bool>
    Verbose("verbose",
            llvm::cl::desc("print callee classification for every call"),
            llvm::cl::cat(Category));

namespace {

// Abstract state bits. The set of reachable states at a program point is a
// bitmask over the 8 combinations of these three bits.
enum : unsigned {
  kPending =
      1, // a callee's ThrowScope simulated a throw; an exception() query is due
  kThrown = 2, // this function threw (or a callee surely did); it must return
               // without calling into JS again
  kReleased =
      4, // this function's own ThrowScope was released (RELEASE_AND_RETURN)
  kMaybe = 8, // a callee may have thrown into our scope and returned a failure
              // value; the bit is clear
  kNumStates = 16,
};

using StateSet = unsigned; // bit i set <=> abstract state i is reachable

static constexpr StateSet kCleanOnly = 1u << 0;

static bool anyState(StateSet s, unsigned bit) {
  for (unsigned st = 0; st < kNumStates; st++)
    if ((s & (1u << st)) && (st & bit))
      return true;
  return false;
}

template <typename F> static StateSet mapStates(StateSet in, F f) {
  StateSet out = 0;
  for (unsigned st = 0; st < kNumStates; st++)
    if (in & (1u << st))
      out |= 1u << (f(st) & (kNumStates - 1));
  return out;
}

// Summary of a callee, as seen by its callers.
struct Summary {
  enum Kind {
    Nothrow,     // cannot throw; does not touch the exception bit
    Check,       // queries the exception (clears the bit)
    Release,     // ThrowScope::release()
    MayThrow,    // declares a scope: after the call, the state is `pending`
    Thrower,     // after the call, the state is `thrown`
    Transparent, // no own scope; exit states are those of its body
  };
  Kind kind = Nothrow;
  bool verifiesAtEntry =
      false; // constructs a scope (or calls into one) before any check
  bool consumesException = false; // takes the pending exception off the VM
                                  // (rejectWithCaughtException)
  StateSet exitStates =
      kCleanOnly; // for Transparent: states at exit when entered clean
  std::string why;

  bool mayThrow() const {
    return kind == MayThrow || kind == Thrower || kind == Transparent;
  }

  static const char *kindName(Kind k) {
    switch (k) {
    case Nothrow:
      return "nothrow";
    case Check:
      return "check";
    case Release:
      return "release";
    case MayThrow:
      return "maythrow";
    case Thrower:
      return "thrower";
    case Transparent:
      return "transparent";
    }
    return "?";
  }
  static bool parseKind(const std::string &s, Kind &out) {
    for (int k = Nothrow; k <= Transparent; k++) {
      if (s == kindName((Kind)k)) {
        out = (Kind)k;
        return true;
      }
    }
    return false;
  }
};

// Merge two summaries for the same name/arity coming from different
// translation units or overloads. The result is the more conservative one.
static Summary mergeSummaries(const Summary &a, const Summary &b) {
  if (a.kind == Summary::MayThrow || b.kind == Summary::MayThrow) {
    Summary s = a.kind == Summary::MayThrow ? a : b;
    return s;
  }
  if (a.kind == b.kind && a.kind != Summary::Transparent)
    return a;
  auto toExit = [](const Summary &s) -> StateSet {
    switch (s.kind) {
    case Summary::Nothrow:
    case Summary::Check:
    case Summary::Release:
      return kCleanOnly;
    case Summary::Thrower:
      return 1u << kThrown;
    case Summary::Transparent:
      return s.exitStates;
    default:
      return kCleanOnly;
    }
  };
  Summary s;
  s.kind = Summary::Transparent;
  s.exitStates = toExit(a) | toExit(b);
  s.verifiesAtEntry = a.verifiesAtEntry || b.verifiesAtEntry;
  s.why = a.why;
  return s;
}

struct Finding {
  std::string file;
  unsigned line = 0;
  unsigned col = 0;
  std::string function;
  std::string callee;
  std::string kind; // pending-call | thrown-call | unchecked-exit |
                    // scope-while-pending | lambda-check
  std::string message;
};

// Explicit classifications from --nothrow/--maythrow files. Each line is
// `<qualified name> [kind]` where kind is one of nothrow (default for the
// --nothrow file), maythrow (default for the --maythrow file), thrower,
// check, checkrelease, release. `indirect:<member>` classifies calls
// through a function pointer member of that name (method tables).
static std::map<std::string, Summary> gClassified;
static std::map<std::string, Summary> gImported; // key: name/arity

static void loadList(const std::string &path, Summary::Kind defaultKind) {
  if (path.empty())
    return;
  std::ifstream in(path);
  std::string line;
  while (std::getline(in, line)) {
    auto hash = line.find('#');
    if (hash != std::string::npos)
      line = line.substr(0, hash);
    std::stringstream ss(line);
    std::string name, kindStr;
    ss >> name >> kindStr;
    if (name.empty())
      continue;
    Summary s;
    s.kind = defaultKind;
    s.why = "allowlist";
    if (kindStr == "nothrow")
      s.kind = Summary::Nothrow;
    else if (kindStr == "maythrow")
      s.kind = Summary::MayThrow;
    else if (kindStr == "thrower")
      s.kind = Summary::Thrower;
    else if (kindStr == "check")
      s.kind = Summary::Check;
    else if (kindStr == "release")
      s.kind = Summary::Release;
    else if (kindStr == "checkrelease") {
      // Consumes the pending exception and releases the caller's scope
      // (JSPromise::rejectWithCaughtException). Modeled as a helper
      // whose exit state is clean+released.
      s.kind = Summary::Transparent;
      s.consumesException = true;
      s.exitStates = (1u << 0) | (1u << kReleased);
    }
    if (s.kind == Summary::MayThrow || s.kind == Summary::Thrower)
      s.verifiesAtEntry = true;
    gClassified[name] = s;
  }
}

// Summary line format (tab separated):
//   mangledName  qualifiedName/arity  kind  exitStates  verifiesAtEntry  why
// The mangled name identifies one overload across translation units. extern
// "C" functions have no mangling and use their plain name.
static void loadSummaries(const std::string &path) {
  std::ifstream in(path);
  std::string line;
  while (std::getline(in, line)) {
    std::vector<std::string> cols;
    std::stringstream ss(line);
    std::string col;
    while (std::getline(ss, col, '\t'))
      cols.push_back(col);
    if (cols.size() < 5)
      continue;
    Summary s;
    if (!Summary::parseKind(cols[2], s.kind))
      continue;
    unsigned exitStates = 0;
    if (llvm::StringRef(cols[3]).getAsInteger(10, exitStates))
      continue; // malformed line
    s.exitStates = exitStates;
    s.verifiesAtEntry = cols[4] == "1";
    s.why = cols.size() > 5 ? cols[5] : "";
    auto it = gImported.find(cols[0]);
    if (it == gImported.end())
      gImported.emplace(cols[0], s);
    else
      it->second = mergeSummaries(it->second, s);
  }
}

static std::string qualifiedName(const NamedDecl *D) {
  std::string s;
  llvm::raw_string_ostream os(s);
  D->printQualifiedName(os);
  return os.str();
}

static std::string summaryKey(const FunctionDecl *FD) {
  return qualifiedName(FD) + "/" + std::to_string(FD->getNumParams());
}

static bool isGlobalObjectRecord(const CXXRecordDecl *RD) {
  if (!RD)
    return false;
  if (RD->getDefinition())
    RD = RD->getDefinition();
  std::string name = qualifiedName(RD);
  if (name == "JSC::JSGlobalObject")
    return true;
  if (!RD->hasDefinition())
    return name.find("GlobalObject") != std::string::npos;
  for (const CXXBaseSpecifier &base : RD->bases()) {
    if (const CXXRecordDecl *baseRD = base.getType()->getAsCXXRecordDecl())
      if (isGlobalObjectRecord(baseRD))
        return true;
  }
  return false;
}

// True for JSC::JSGlobalObject* (or any subclass pointer/reference) and
// JSC::ThrowScope&. These are the JSC conventions for "may throw".
static bool isThrowCarrierType(QualType T) {
  T = T.getNonReferenceType();
  if (T->isPointerType())
    T = T->getPointeeType();
  const CXXRecordDecl *RD = T->getAsCXXRecordDecl();
  if (!RD)
    return false;
  std::string name = qualifiedName(RD);
  if (name == "JSC::ThrowScope")
    return true;
  return isGlobalObjectRecord(RD);
}

// A JSGlobalObject* parameter means "may throw" only when the function was
// written for a global object. In an instantiation of WriteBarrier<T>::set or
// jsCast<T*> with T = JSGlobalObject the type is incidental, so look at the
// template pattern's parameter types and ignore the dependent ones.
static bool hasThrowCarrierParam(const FunctionDecl *FD) {
  const FunctionDecl *pattern = FD->getTemplateInstantiationPattern();
  if (pattern && pattern->getNumParams() == FD->getNumParams()) {
    for (unsigned i = 0; i < FD->getNumParams(); i++) {
      QualType patternType = pattern->getParamDecl(i)->getType();
      if (patternType->isDependentType())
        continue;
      if (isThrowCarrierType(FD->getParamDecl(i)->getType()))
        return true;
    }
    return false;
  }
  for (const ParmVarDecl *P : FD->parameters())
    if (isThrowCarrierType(P->getType()))
      return true;
  return false;
}

static bool hasThrowCarrierParam(const FunctionProtoType *FPT) {
  if (!FPT)
    return false;
  for (QualType T : FPT->getParamTypes())
    if (isThrowCarrierType(T))
      return true;
  return false;
}

static bool isScopeRecordName(const std::string &name) {
  return name == "JSC::ThrowScope" || name == "JSC::TopExceptionScope";
}

static bool isScopeType(QualType T) {
  const CXXRecordDecl *RD = T.getNonReferenceType()->getAsCXXRecordDecl();
  return RD && isScopeRecordName(qualifiedName(RD));
}

static bool isExceptionOwnerRecord(const CXXRecordDecl *RD) {
  if (!RD)
    return false;
  std::string n = qualifiedName(RD);
  return n == "JSC::VM" || n == "JSC::ExceptionScope" ||
         n == "JSC::ThrowScope" || n == "JSC::TopExceptionScope";
}

class Analyzer {
public:
  Analyzer(ASTContext &Ctx, std::vector<Finding> &out)
      : m_ctx(Ctx), m_sm(Ctx.getSourceManager()), m_findings(out),
        m_mangler(ItaniumMangleContext::create(Ctx, Ctx.getDiagnostics())) {}

  // One name per overload, stable across translation units.
  std::string mangledKey(const FunctionDecl *FD) {
    if (!m_mangler->shouldMangleDeclName(FD))
      return FD->getNameAsString();
    std::string out;
    llvm::raw_string_ostream os(out);
    if (const auto *ctor = dyn_cast<CXXConstructorDecl>(FD))
      m_mangler->mangleName(GlobalDecl(ctor, Ctor_Complete), os);
    else if (const auto *dtor = dyn_cast<CXXDestructorDecl>(FD))
      m_mangler->mangleName(GlobalDecl(dtor, Dtor_Complete), os);
    else
      m_mangler->mangleName(GlobalDecl(FD), os);
    return os.str();
  }

  // Classify a function for its callers. Memoized. Visible bodies are
  // analyzed; invisible ones fall back to imported summaries, then to the
  // JSC signature convention.
  const Summary &summarize(const FunctionDecl *FD) {
    FD = FD->getCanonicalDecl();
    auto it = m_summaries.find(FD);
    if (it != m_summaries.end())
      return it->second;
    // Cycle guard: while a function is being analyzed, treat recursive
    // calls to it as nothrow. This under-approximates recursion only.
    Summary &slot = m_summaries[FD];
    slot.kind = Summary::Nothrow;
    slot.why = "in progress";
    Summary computed = computeSummary(FD);
    m_summaries[FD] = computed;
    return m_summaries[FD];
  }

  // Analyze one function body and report findings.
  void analyzeFunction(const FunctionDecl *FD) {
    if (!FD->doesThisDeclarationHaveABody() || !FD->getBody())
      return;
    if (!m_analyzed.insert(FD->getCanonicalDecl()).second)
      return;
    runBody(FD, /*report=*/true);
    if (!ExportSummaries.empty())
      summarize(FD);
  }

  // Summaries of functions with visible bodies, for --export-summaries.
  static bool matchesAny(const std::string &file,
                         const std::vector<std::string> &unders) {
    for (const std::string &u : unders)
      if (file.rfind(u, 0) == 0)
        return true;
    return false;
  }

  void exportSummaries(llvm::raw_ostream &os,
                       const std::vector<std::string> &under) {
    for (auto &[FD, s] : m_summaries) {
      if (s.kind == Summary::Check || s.kind == Summary::Release)
        continue;
      if (s.why == "allowlist" || s.why == "imported")
        continue;
      if (s.why.rfind("no visible body", 0) == 0) {
        // Not a summary: a leaf the analysis had to guess. Listed so
        // the driver can report the most common guesses. The import
        // side skips the "unknown" kind.
        if (s.kind == Summary::MayThrow)
          os << mangledKey(FD) << "\t" << summaryKey(FD) << "\tunknown\t0\t0\t"
             << s.why << "\n";
        continue;
      }
      const FunctionDecl *def = nullptr;
      if (!FD->hasBody(def) || !def)
        continue;
      if (isa<CXXMethodDecl>(def) &&
          cast<CXXMethodDecl>(def)->getParent()->isLambda())
        continue;
      PresumedLoc P =
          m_sm.getPresumedLoc(m_sm.getExpansionLoc(def->getLocation()));
      if (!P.isValid())
        continue;
      std::string file = P.getFilename();
      if (!matchesAny(file, under))
        continue;
      os << mangledKey(FD) << "\t" << summaryKey(FD) << "\t"
         << Summary::kindName(s.kind) << "\t" << s.exitStates << "\t"
         << (s.verifiesAtEntry ? "1" : "0") << "\t" << s.why << "\n";
    }
  }

  // Force summaries for every function with a body in the TU (for export).
  void summarizeForExport(const FunctionDecl *FD) {
    if (!FD->doesThisDeclarationHaveABody() || !FD->getBody())
      return;
    summarize(FD);
  }

private:
  struct BodyResult {
    StateSet exitStates = kCleanOnly;
    bool hasOwnScope = false;
    bool touchesException = false; // any may-throw call or scope
    bool verifiesAtEntry = false;
    std::string firstCause; // what made this body touch the exception state
  };

  std::string locString(SourceLocation loc) {
    PresumedLoc P = m_sm.getPresumedLoc(m_sm.getExpansionLoc(loc));
    if (!P.isValid())
      return "?";
    std::string f = P.getFilename();
    auto pos = f.rfind('/');
    if (pos != std::string::npos)
      f = f.substr(pos + 1);
    return f + ":" + std::to_string(P.getLine());
  }

  Summary computeSummary(const FunctionDecl *FD) {
    Summary s;
    std::string name = qualifiedName(FD);

    // Explicit lists win.
    {
      auto it = gClassified.find(name);
      if (it != gClassified.end())
        return it->second;
    }

    // Exception-state accessors.
    if (const auto *MD = dyn_cast<CXXMethodDecl>(FD)) {
      if (isExceptionOwnerRecord(MD->getParent())) {
        StringRef n = MD->getIdentifier() ? MD->getName() : StringRef();
        if (n == "exception" || n == "clearException" ||
            n == "assertNoException" || n == "releaseAssertNoException" ||
            n == "assertNoExceptionExceptTermination" ||
            n == "releaseAssertNoExceptionExceptTermination" ||
            n == "tryClearException" ||
            n == "clearExceptionExceptTermination" ||
            n == "hasExceptionsAfterHandlingTraps") {
          s.kind = Summary::Check;
          s.why = "exception accessor";
          return s;
        }
        if (n == "release") {
          s.kind = Summary::Release;
          s.why = "scope release";
          return s;
        }
        if (n == "throwException") {
          s.kind = Summary::Thrower;
          s.verifiesAtEntry = true;
          s.why = "throwException";
          return s;
        }
      }
    }

    const FunctionDecl *def = nullptr;
    if (FD->hasBody(def) && def && def->getBody() && !def->isDefaulted()) {
      // Visible body. Analyze it.
      BodyResult r = runBody(def, /*report=*/false);
      if (r.hasOwnScope) {
        s.kind = Summary::MayThrow;
        s.verifiesAtEntry = true;
        s.why = "declares a ThrowScope";
        return s;
      }
      if (!r.touchesException) {
        s.kind = Summary::Nothrow;
        s.why = "body cannot throw";
        return s;
      }
      if (!anyState(r.exitStates, kPending | kThrown | kReleased | kMaybe)) {
        // It checks everything it calls before returning. Callers see
        // no pending bit, exactly like the validator.
        s.kind = Summary::Transparent;
        s.verifiesAtEntry = r.verifiesAtEntry;
        s.exitStates = r.exitStates;
        s.why = "self-checking body (" + r.firstCause + ")";
        return s;
      }
      // Transparent helper: no scope of its own.
      s.kind = Summary::Transparent;
      s.verifiesAtEntry = r.verifiesAtEntry;
      s.exitStates = r.exitStates;
      s.why = "calls " + r.firstCause;
      return s;
    }

    // Throw helpers with no visible body are terminators: throwTypeError,
    // throwVMError, throwOutOfMemoryError, Bun::ERR::*, Bun::throwError, ...
    {
      StringRef n = FD->getIdentifier() ? FD->getName() : StringRef();
      bool inErrNamespace = name.rfind("Bun::ERR::", 0) == 0 ||
                            name.rfind("WebCore::ERR::", 0) == 0;
      if ((n.starts_with("throw") && hasThrowCarrierParam(FD)) ||
          inErrNamespace) {
        s.kind = Summary::Thrower;
        s.verifiesAtEntry = true;
        s.why = "throw helper";
        return s;
      }
    }

    // Imported whole-project summary.
    {
      auto it = gImported.find(mangledKey(FD));
      if (it != gImported.end()) {
        s = it->second;
        s.why = "imported";
        return s;
      }
    }

    // An extern "C" function with no body in any C++ translation unit is
    // implemented in Rust. The Rust side runs under its own exception
    // scope and reports a throw with a sentinel return value (empty
    // JSValue, false, null), so the caller sees a conditional thrower.
    if (FD->isExternC() && hasThrowCarrierParam(FD)) {
      s.kind = Summary::Transparent;
      s.verifiesAtEntry = true;
      s.exitStates = kCleanOnly | (1u << kThrown);
      s.why = "extern \"C\" with no C++ body (Rust); a throw is signaled by "
              "the return value";
      return s;
    }

    // Virtual methods and unknown bodies: JSC convention.
    if (hasThrowCarrierParam(FD)) {
      s.kind = Summary::MayThrow;
      s.verifiesAtEntry = true;
      s.why = "no visible body; takes JSGlobalObject*/ThrowScope&";
      return s;
    }
    s.kind = Summary::Nothrow;
    s.why = "no visible body; no throw carrier parameter";
    return s;
  }

  // The callee of a call expression, or null for indirect calls.
  static const FunctionDecl *calleeOf(const CallExpr *CE) {
    if (const FunctionDecl *FD = CE->getDirectCallee())
      return FD;
    return nullptr;
  }

  Summary summarizeCall(const CallExpr *CE) {
    if (const FunctionDecl *FD = calleeOf(CE))
      return summarize(FD);
    // Indirect call: a method-table function pointer, a std::function,
    // a lambda through a pointer. Use the member name, then the signature.
    Summary s;
    const Expr *calleeExpr = CE->getCallee()->IgnoreParenImpCasts();
    if (const auto *ME = dyn_cast<MemberExpr>(calleeExpr)) {
      auto it = gClassified.find("indirect:" +
                                 ME->getMemberDecl()->getNameAsString());
      if (it != gClassified.end())
        return it->second;
    }
    QualType T = calleeExpr->getType();
    if (T->isPointerType() || T->isMemberPointerType())
      T = T->getPointeeType();
    if (const auto *FPT = T->getAs<FunctionProtoType>()) {
      if (hasThrowCarrierParam(FPT)) {
        s.kind = Summary::MayThrow;
        s.verifiesAtEntry = true;
        s.why = "indirect call; signature takes JSGlobalObject*/ThrowScope&";
        return s;
      }
    }
    s.kind = Summary::Nothrow;
    s.why = "indirect call; no throw carrier parameter";
    return s;
  }

  std::string describeCallee(const CallExpr *CE) {
    if (!calleeOf(CE)) {
      if (const auto *ME =
              dyn_cast<MemberExpr>(CE->getCallee()->IgnoreParenImpCasts()))
        return "<indirect call through " +
               ME->getMemberDecl()->getNameAsString() + ">";
    }
    if (const FunctionDecl *FD = calleeOf(CE)) {
      if (const auto *MD = dyn_cast<CXXMethodDecl>(FD)) {
        if (MD->getParent()->isLambda())
          return "<lambda at " + locString(MD->getParent()->getLocation()) +
                 ">";
      }
      return qualifiedName(FD);
    }
    return "<indirect call>";
  }

  void report(const FunctionDecl *FD, SourceLocation loc,
              const std::string &kind, const std::string &callee,
              const std::string &message) {
    SourceLocation spelling = m_sm.getExpansionLoc(loc);
    PresumedLoc P = m_sm.getPresumedLoc(spelling);
    Finding f;
    f.file = P.isValid() ? P.getFilename() : "<unknown>";
    f.line = P.isValid() ? P.getLine() : 0;
    f.col = P.isValid() ? P.getColumn() : 0;
    f.function = qualifiedName(FD);
    if (const auto *MD = dyn_cast<CXXMethodDecl>(FD))
      if (MD->getParent()->isLambda())
        f.function =
            "<lambda at " + locString(MD->getParent()->getLocation()) + ">";
    f.callee = callee;
    f.kind = kind;
    f.message = message;
    m_findings.push_back(std::move(f));
  }

  // Per-walk context: the last call that made the state pending/thrown, for
  // the hint in messages.
  struct WalkCtx {
    std::string lastSource;
  };

  // Apply one CFG element to a state set. Returns the new state set.
  // `report` controls whether violations are recorded.
  StateSet step(const FunctionDecl *FD, const CFGElement &E, StateSet in,
                bool report, BodyResult &result, WalkCtx &ctx) {
    if (auto dtor = E.getAs<CFGAutomaticObjDtor>()) {
      const VarDecl *VD = dtor->getVarDecl();
      if (!VD || !isScopeType(VD->getType()))
        return in;
      std::string rdName = qualifiedName(VD->getType()->getAsCXXRecordDecl());
      bool isTop = rdName == "JSC::TopExceptionScope";
      bool reported = false;
      StateSet out = mapStates(in, [&](unsigned st) {
        bool pending = st & kPending;
        bool released = st & kReleased;
        if (pending && (isTop || !released) && report && !reported) {
          reported = true;
          SourceLocation loc = dtor->getTriggerStmt()
                                   ? dtor->getTriggerStmt()->getEndLoc()
                                   : VD->getLocation();
          this->report(FD, loc, "unchecked-exit", ctx.lastSource,
                       "function exits with an exception check pending after " +
                           ctx.lastSource + " (the " +
                           (isTop ? "TopExceptionScope" : "ThrowScope") +
                           " destructor asserts); add RETURN_IF_EXCEPTION or "
                           "use RELEASE_AND_RETURN");
        }
        // After a ThrowScope destructor the caller must check
        // (simulateThrow). TopExceptionScope does not simulate.
        if (!isTop)
          return st | kPending;
        return st & ~kPending;
      });
      if (!isTop)
        ctx.lastSource =
            "the nested ThrowScope declared at " + locString(VD->getLocation());
      return out;
    }

    auto stmtElem = E.getAs<CFGStmt>();
    if (!stmtElem)
      return in;
    const Stmt *S = stmtElem->getStmt();

    // Scope construction.
    if (const auto *CC = dyn_cast<CXXConstructExpr>(S)) {
      const CXXConstructorDecl *ctor = CC->getConstructor();
      if (ctor && isScopeRecordName(qualifiedName(ctor->getParent())) &&
          !ctor->isCopyOrMoveConstructor()) {
        // A TopExceptionScope verifies like a ThrowScope but does not
        // simulate a throw when destroyed, so it does not make the
        // function "may throw" for its callers.
        if (qualifiedName(ctor->getParent()) == "JSC::ThrowScope")
          result.hasOwnScope = true;
        if (!result.touchesException) {
          result.verifiesAtEntry = true;
          result.firstCause = "ThrowScope at " + locString(CC->getBeginLoc());
        }
        result.touchesException = true;
        if (anyState(in, kPending) && report)
          this->report(FD, CC->getBeginLoc(), "scope-while-pending",
                       ctx.lastSource,
                       "ThrowScope constructed while an exception check is "
                       "pending after " +
                           ctx.lastSource);
        return mapStates(in, [](unsigned st) { return st & ~kPending; });
      }
      // Constructors that take a global object may run JS (rare).
      if (ctor && hasThrowCarrierParam(ctor)) {
        Summary s = summarize(ctor);
        return applyCallSummary(FD, CC->getBeginLoc(), qualifiedName(ctor), s,
                                in, report, result, ctx);
      }
      return in;
    }

    if (const auto *RS = dyn_cast<ReturnStmt>(S)) {
      // The early return of RETURN_IF_EXCEPTION: the check happened and
      // the exception is set. For a lambda or a scope-less helper this
      // exit state tells the caller that an exception may be pending
      // even though the bit is clear.
      if (isInReturnIfExceptionMacro(RS))
        return mapStates(
            in, [](unsigned st) { return (st & kReleased) | kThrown; });
      return in;
    }

    const auto *CE = dyn_cast<CallExpr>(S);
    if (!CE)
      return in;
    Summary s = summarizeCall(CE);
    if (Verbose) {
      llvm::errs() << locString(CE->getBeginLoc()) << " call "
                   << describeCallee(CE) << " -> " << Summary::kindName(s.kind)
                   << " exit=" << s.exitStates << " (" << s.why << ")\n";
    }
    return applyCallSummary(FD, CE->getBeginLoc(), describeCallee(CE), s, in,
                            report, result, ctx);
  }

  // True when the statement is spelled inside a RETURN_IF_EXCEPTION-style
  // macro expansion.
  bool isInReturnIfExceptionMacro(const Stmt *S) {
    SourceLocation loc = S->getBeginLoc();
    if (!loc.isMacroID())
      return false;
    while (loc.isMacroID()) {
      StringRef name =
          Lexer::getImmediateMacroName(loc, m_sm, m_ctx.getLangOpts());
      if (name.contains("RETURN_IF_EXCEPTION") ||
          name.contains("RETURN_IF_VM_EXCEPTION") ||
          name.contains("RETURN_STATUS_IF_EXCEPTION") ||
          name == "TRY_CLEAR_EXCEPTION")
        return true;
      loc = m_sm.getImmediateMacroCallerLoc(loc);
    }
    return false;
  }

  StateSet applyCallSummary(const FunctionDecl *FD, SourceLocation loc,
                            const std::string &callee, const Summary &s,
                            StateSet in, bool report, BodyResult &result,
                            WalkCtx &ctx) {
    switch (s.kind) {
    case Summary::Nothrow:
      return in;
    case Summary::Check:
      result.touchesException = true;
      return mapStates(
          in, [](unsigned st) { return st & ~(kPending | kThrown | kMaybe); });
    case Summary::Release:
      return mapStates(in, [](unsigned st) { return st | kReleased; });
    case Summary::MayThrow:
    case Summary::Thrower:
    case Summary::Transparent: {
      if (!result.touchesException) {
        result.verifiesAtEntry = s.verifiesAtEntry;
        result.firstCause = callee + " at " + locString(loc);
      }
      result.touchesException = true;
      if (s.consumesException) {
        // The helper reads and clears the exception itself; a pending
        // or thrown state is what it expects.
        in = mapStates(in, [](unsigned st) { return st & kReleased; });
      }
      if (report) {
        if (anyState(in, kPending) && s.verifiesAtEntry)
          this->report(FD, loc, "pending-call", callee,
                       "call to " + callee +
                           " while an exception check is pending after " +
                           ctx.lastSource +
                           "; add RETURN_IF_EXCEPTION after it");
        if (anyState(in, kThrown))
          this->report(FD, loc, "thrown-call", callee,
                       "call to " + callee + " after " + ctx.lastSource +
                           " threw; return after throwing");
        else if (anyState(in, kMaybe))
          this->report(FD, loc, "maybe-thrown-call", callee,
                       "call to " + callee + " after " + ctx.lastSource +
                           " may have thrown and returned a failure value; "
                           "check the exception or the result first");
      }
      // Exit states of the callee, as seen from here. A conditional
      // thrower (exits both clean and thrown) becomes `maybe`: the
      // caller usually tests its return value, which the analysis
      // cannot see.
      StateSet calleeExits;
      switch (s.kind) {
      case Summary::MayThrow:
        calleeExits = 1u << kPending;
        break;
      case Summary::Thrower:
        calleeExits = 1u << kThrown;
        break;
      default:
        calleeExits = s.exitStates;
        break;
      }
      bool hasClean = false, hasThrown = false;
      for (unsigned ex = 0; ex < kNumStates; ex++) {
        if (!(calleeExits & (1u << ex)))
          continue;
        if (!(ex & (kPending | kThrown | kMaybe)))
          hasClean = true;
        if (ex & kThrown)
          hasThrown = true;
      }
      StateSet out = 0;
      for (unsigned st = 0; st < kNumStates; st++) {
        if (!(in & (1u << st)))
          continue;
        unsigned keep = st & kReleased;
        for (unsigned ex = 0; ex < kNumStates; ex++) {
          if (!(calleeExits & (1u << ex)))
            continue;
          unsigned bits = ex & (kPending | kThrown | kMaybe | kReleased);
          if ((bits & kThrown) && hasClean && hasThrown)
            bits = (bits & ~kThrown) | kMaybe;
          out |= 1u << ((keep | bits) & (kNumStates - 1));
        }
      }
      if (anyState(out, kPending | kThrown | kMaybe))
        ctx.lastSource = callee + " (" + locString(loc) + ")";
      return out;
    }
    }
    return in;
  }

  BodyResult runBody(const FunctionDecl *FD, bool report) {
    BodyResult result;
    CFG::BuildOptions opts;
    opts.AddImplicitDtors = true;
    opts.AddTemporaryDtors = true;
    opts.AddInitializers = true;
    opts.AddCXXDefaultInitExprInCtors = true;
    opts.setAllAlwaysAdd();
    std::unique_ptr<CFG> cfg = CFG::buildCFG(FD, FD->getBody(), &m_ctx, opts);
    if (!cfg)
      return result;

    unsigned n = cfg->getNumBlockIDs();
    std::vector<StateSet> inStates(n, 0), outStates(n, 0);
    std::vector<std::string> inSource(n), outSource(n);
    std::vector<bool> inSourceDirty(
        n,
        false); // inSource came from a predecessor with a pending/thrown state
    inStates[cfg->getEntry().getBlockID()] = kCleanOnly;

    // Worklist fixpoint. The lattice is tiny (8 bits), so this converges fast.
    std::vector<const CFGBlock *> work;
    std::vector<bool> queued(n, false);
    work.push_back(&cfg->getEntry());
    queued[cfg->getEntry().getBlockID()] = true;
    while (!work.empty()) {
      const CFGBlock *B = work.back();
      work.pop_back();
      unsigned id = B->getBlockID();
      queued[id] = false;
      StateSet st = inStates[id];
      BodyResult scratch;
      WalkCtx ctx;
      ctx.lastSource = inSource[id];
      for (const CFGElement &E : *B)
        st = step(FD, E, st, /*report=*/false, scratch, ctx);
      bool changed = st != outStates[id] || outSource[id] != ctx.lastSource;
      outStates[id] = st;
      outSource[id] = ctx.lastSource;
      if (!changed && st != 0)
        continue;
      for (const CFGBlock::AdjacentBlock &succ : B->succs()) {
        const CFGBlock *S = succ.getReachableBlock();
        if (!S)
          continue;
        unsigned sid = S->getBlockID();
        StateSet merged = inStates[sid] | st;
        bool srcChanged = false;
        bool dirty = anyState(st, kPending | kThrown | kMaybe);
        if (!ctx.lastSource.empty() &&
            (inSource[sid].empty() || (dirty && !inSourceDirty[sid]))) {
          inSource[sid] = ctx.lastSource;
          inSourceDirty[sid] = dirty;
          srcChanged = true;
        }
        if (merged != inStates[sid] || srcChanged || !queued[sid]) {
          inStates[sid] = merged;
          if (!queued[sid]) {
            queued[sid] = true;
            work.push_back(S);
          }
        }
      }
    }

    // Final pass: report, and compute the body facts.
    for (const CFGBlock *B : *cfg) {
      unsigned id = B->getBlockID();
      StateSet st = inStates[id];
      if (st == 0)
        continue; // unreachable
      WalkCtx ctx;
      ctx.lastSource = inSource[id];
      for (const CFGElement &E : *B)
        st = step(FD, E, st, report, result, ctx);
    }
    result.exitStates = inStates[cfg->getExit().getBlockID()];
    if (result.exitStates == 0)
      result.exitStates = kCleanOnly; // no normal exit (noreturn)
    return result;
  }

  ASTContext &m_ctx;
  SourceManager &m_sm;
  std::vector<Finding> &m_findings;
  std::unique_ptr<ItaniumMangleContext> m_mangler;
  std::unordered_map<const FunctionDecl *, Summary> m_summaries;
  std::unordered_set<const FunctionDecl *> m_analyzed;
};

class Visitor : public RecursiveASTVisitor<Visitor> {
public:
  Visitor(ASTContext &Ctx, Analyzer &A, std::string onlyUnder,
          std::vector<std::string> exportUnder)
      : m_ctx(Ctx), m_analyzer(A), m_onlyUnder(std::move(onlyUnder)),
        m_exportUnder(std::move(exportUnder)) {}

  bool shouldVisitTemplateInstantiations() const { return true; }
  bool shouldVisitImplicitCode() const { return false; }

  bool VisitFunctionDecl(FunctionDecl *FD) {
    maybeAnalyze(FD);
    return true;
  }

  bool VisitLambdaExpr(LambdaExpr *LE) {
    if (CXXMethodDecl *op = LE->getCallOperator())
      maybeAnalyze(op);
    return true;
  }

private:
  void maybeAnalyze(FunctionDecl *FD) {
    if (!FD->doesThisDeclarationHaveABody() || !FD->getBody())
      return;
    if (FD->isDependentContext())
      return; // uninstantiated template pattern; instantiations are visited
              // separately
    SourceManager &SM = m_ctx.getSourceManager();
    SourceLocation loc = SM.getExpansionLoc(FD->getLocation());
    if (loc.isInvalid())
      return;
    PresumedLoc P = SM.getPresumedLoc(loc);
    if (!P.isValid())
      return;
    std::string file = P.getFilename();
    if (file.find(m_onlyUnder) != std::string::npos)
      m_analyzer.analyzeFunction(FD);
    else if (!ExportSummaries.empty() &&
             Analyzer::matchesAny(file, m_exportUnder))
      m_analyzer.summarizeForExport(FD);
  }

  ASTContext &m_ctx;
  Analyzer &m_analyzer;
  std::string m_onlyUnder;
  std::vector<std::string> m_exportUnder;
};

class Consumer : public ASTConsumer {
public:
  void HandleTranslationUnit(ASTContext &Ctx) override {
    std::vector<Finding> findings;
    Analyzer analyzer(Ctx, findings);
    std::vector<std::string> exportUnder(ExportUnder.begin(),
                                         ExportUnder.end());
    Visitor visitor(Ctx, analyzer, OnlyPathPrefix, exportUnder);
    visitor.TraverseDecl(Ctx.getTranslationUnitDecl());

    if (!ExportSummaries.empty()) {
      std::error_code ec;
      llvm::raw_fd_ostream os(ExportSummaries, ec,
                              llvm::sys::fs::OF_Append |
                                  llvm::sys::fs::OF_Text);
      if (!ec)
        analyzer.exportSummaries(os, exportUnder);
    }

    // Dedupe (template instantiations report the same line many times).
    std::set<std::string> seen;
    for (const Finding &f : findings) {
      std::string key = f.file + ":" + std::to_string(f.line) + ":" +
                        std::to_string(f.col) + ":" + f.kind + ":" + f.callee;
      if (!seen.insert(key).second)
        continue;
      if (JsonOutput) {
        auto esc = [](const std::string &s) {
          std::string o;
          for (char c : s) {
            if (c == '"' || c == '\\')
              o += '\\';
            if (c == '\n') {
              o += "\\n";
              continue;
            }
            o += c;
          }
          return o;
        };
        llvm::outs() << "{\"file\":\"" << esc(f.file)
                     << "\",\"line\":" << f.line << ",\"col\":" << f.col
                     << ",\"function\":\"" << esc(f.function)
                     << "\",\"callee\":\"" << esc(f.callee) << "\",\"kind\":\""
                     << f.kind << "\",\"message\":\"" << esc(f.message)
                     << "\"}\n";
      } else {
        llvm::outs() << f.file << ":" << f.line << ":" << f.col << ": ["
                     << f.kind << "] in " << f.function << ": " << f.message
                     << "\n";
      }
    }
    llvm::outs().flush();
  }
};

class Action : public ASTFrontendAction {
public:
  std::unique_ptr<ASTConsumer> CreateASTConsumer(CompilerInstance &CI,
                                                 StringRef) override {
    // We only need the AST. Silence diagnostics from the huge header set.
    CI.getDiagnostics().setIgnoreAllWarnings(true);
    return std::make_unique<Consumer>();
  }
};

} // namespace

int main(int argc, const char **argv) {
  auto parser = CommonOptionsParser::create(argc, argv, Category);
  if (!parser) {
    llvm::errs() << llvm::toString(parser.takeError());
    return 1;
  }
  loadList(NothrowFile, Summary::Nothrow);
  loadList(ThrowFile, Summary::MayThrow);
  for (const std::string &path : ImportSummaries)
    loadSummaries(path);
  ClangTool tool(parser->getCompilations(), parser->getSourcePathList());
  // Drop flags that only matter for code generation and slow down parsing.
  tool.appendArgumentsAdjuster(getClangStripOutputAdjuster());
  tool.appendArgumentsAdjuster(getClangStripDependencyFileAdjuster());
  tool.appendArgumentsAdjuster(getInsertArgumentAdjuster(
      "-Wno-everything", ArgumentInsertPosition::END));
  tool.appendArgumentsAdjuster(
      getInsertArgumentAdjuster("-fsyntax-only", ArgumentInsertPosition::END));
  // The build writes shell-escaped quotes into the arguments array
  // (-DFOO=\"bar\"). The PCH was built with the unescaped value, so the
  // macro definitions have to match or clang rejects the PCH.
  tool.appendArgumentsAdjuster([](const CommandLineArguments &args, StringRef) {
    CommandLineArguments out;
    for (std::string a : args) {
      if (a.rfind("-D", 0) == 0) {
        std::string fixed;
        for (size_t i = 0; i < a.size(); i++) {
          if (a[i] == '\\' && i + 1 < a.size() && a[i + 1] == '"')
            continue;
          fixed += a[i];
        }
        a = fixed;
      }
      out.push_back(a);
    }
    return out;
  });
  return tool.run(newFrontendActionFactory<Action>().get());
}
