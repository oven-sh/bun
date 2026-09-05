// jsc-exception-lint: a clang checker for JavaScriptCore exception discipline
// in Bun's C++ bindings. One source, two builds: a LibTooling program
// (scripts/jsc-exception-lint/run.ts, whole-tree runs and summary passes) and,
// with -DJSC_EXCEPTION_LINT_PLUGIN, a compiler plugin that the build loads
// into every C++ compile (scripts/build/exception-lint.ts), where a finding is
// a compile error.
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
// (--export-summaries / --import-summaries; the committed ones live in
// scripts/jsc-exception-lint/summaries). For everything else the JSC
// convention applies: a parameter of type JSGlobalObject* (or a subclass), or
// ThrowScope&, means it may throw, unless the qualified name is listed in the
// nothrow allowlist passed with --nothrow=<file>.

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
#include "clang/Frontend/FrontendPluginRegistry.h"
#include "clang/Lex/Lexer.h"
#include "clang/Tooling/CommonOptionsParser.h"
#include "clang/Tooling/Tooling.h"
#include "llvm/Support/CommandLine.h"
#include "llvm/Support/FileSystem.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/Path.h"
#include "llvm/Support/raw_ostream.h"

#include <chrono>
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

// Options shared by the standalone tool (set from the command line) and the
// compiler plugin (set from -plugin-arg key=value pairs).
struct Options {
  std::string nothrowFile;
  std::string maythrowFile;
  // Analyze the functions defined in files whose real path contains this.
  std::string onlyUnder = "src/jsc/bindings";
  // Repository root (real path). Baseline keys are relative to it.
  std::string root;
  // Plugin mode: findings listed in this file are not reported.
  std::string baselineFile;
  std::string exportSummaries;
  std::vector<std::string> exportUnder;
  std::vector<std::string> importSummaries;
  bool json = false;
  bool verbose = false;
  bool werror = false; // plugin mode: findings are errors, not warnings
  bool time = false;
};
static Options gOptions;

#ifndef JSC_EXCEPTION_LINT_PLUGIN
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
    llvm::cl::desc(
        "path substring that selects functions to export (repeatable)"),
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
#endif

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
  SourceLocation loc; // expansion location, for compiler diagnostics
  std::string file;
  unsigned line = 0;
  unsigned col = 0;
  std::string function;
  // The function column of the baseline key: the qualified name and the
  // parameter types, so that overloads do not share an entry.
  std::string functionKey;
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
static long gCfgCount = 0;
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
//   conventional
// Columns after the fifth are optional; the committed files drop `why`.
// The mangled name identifies one overload across translation units. extern
// "C" functions have no mangling and use their plain name.
static void loadSummaries(const std::string &path) {
  // Read in one go and split in place: this runs in every compiler process
  // the build starts.
  auto buffer = llvm::MemoryBuffer::getFile(path);
  if (!buffer)
    return;
  StringRef rest = (*buffer)->getBuffer();
  while (!rest.empty()) {
    StringRef line;
    std::tie(line, rest) = rest.split('\n');
    llvm::SmallVector<StringRef, 8> cols;
    line.split(cols, '\t');
    if (cols.size() < 5)
      continue;
    Summary s;
    if (!Summary::parseKind(cols[2].str(), s.kind))
      continue;
    unsigned exitStates = 0;
    if (cols[3].getAsInteger(10, exitStates))
      continue; // malformed line
    s.exitStates = exitStates;
    s.verifiesAtEntry = cols[4] == "1";
    if (cols.size() > 5)
      s.why = cols[5].str();
    auto it = gImported.find(cols[0].str());
    if (it == gImported.end())
      gImported.emplace(cols[0].str(), std::move(s));
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

// Absolute path of a file, symlinks resolved. The build compiles with paths
// relative to the build directory (../../src/...), so the spelled name
// cannot be compared with the repo root.
static std::string realPathOf(FileEntryRef ref) {
  StringRef real = ref.getFileEntry().tryGetRealPathName();
  if (!real.empty())
    return real.str();
  llvm::SmallString<256> abs(ref.getName());
  llvm::sys::fs::make_absolute(abs);
  llvm::sys::path::remove_dots(abs, /*remove_dot_dot=*/true);
  return std::string(abs);
}

// Real paths of the files of one translation unit, one lookup per file
// instead of one per declaration.
class PathCache {
public:
  explicit PathCache(SourceManager &SM) : m_sm(SM) {}

  const std::string &get(FileID fid) {
    auto it = m_paths.find(fid);
    if (it != m_paths.end())
      return it->second;
    std::string path;
    if (OptionalFileEntryRef ref = m_sm.getFileEntryRefForID(fid))
      path = realPathOf(*ref);
    return m_paths.emplace(fid, std::move(path)).first->second;
  }

  // Empty for locations that are not in a file (builtins, command line).
  const std::string &get(SourceLocation loc) {
    static const std::string empty;
    loc = m_sm.getExpansionLoc(loc);
    if (loc.isInvalid())
      return empty;
    return get(m_sm.getFileID(loc));
  }

private:
  SourceManager &m_sm;
  std::map<FileID, std::string> m_paths;
};

static std::string summaryKey(const FunctionDecl *FD) {
  return qualifiedName(FD) + "/" + std::to_string(FD->getNumParams());
}

// `name(type, type)`, and for a member function its qualifiers (` const`,
// ` &&`): overloads can differ in those alone. Types print with their full
// scope whatever the source spells (`JSGlobalObject *` under a
// using-directive is `JSC::JSGlobalObject *`), and typedefs stay typedefs, so
// the key is the same on every platform. A template instantiation uses its
// pattern, so that every instantiation has the key of the template (`T`, not
// `int`).
static std::string signatureKey(const FunctionDecl *FD) {
  if (const FunctionDecl *pattern = FD->getTemplateInstantiationPattern())
    FD = pattern;
  FD = FD->getCanonicalDecl();
  PrintingPolicy policy = FD->getASTContext().getPrintingPolicy();
  policy.SuppressElaboration = true;
  std::string key = qualifiedName(FD) + "(";
  for (unsigned i = 0; i < FD->getNumParams(); i++) {
    if (i)
      key += ", ";
    key += FD->getParamDecl(i)->getType().getAsString(policy);
  }
  if (const auto *FPT = FD->getType()->getAs<FunctionProtoType>())
    if (FPT->isVariadic())
      key += FD->getNumParams() ? ", ..." : "...";
  key += ")";
  if (const auto *MD = dyn_cast<CXXMethodDecl>(FD)) {
    Qualifiers quals = MD->getMethodQualifiers();
    if (quals.hasConst())
      key += " const";
    if (quals.hasVolatile())
      key += " volatile";
    if (MD->getRefQualifier() == RQ_LValue)
      key += " &";
    else if (MD->getRefQualifier() == RQ_RValue)
      key += " &&";
  }
  return key;
}

static bool isGlobalObjectRecord(const CXXRecordDecl *RD) {
  if (!RD)
    return false;
  if (RD->getDefinition())
    RD = RD->getDefinition();
  std::string name = qualifiedName(RD);
  if (name == "JSC::JSGlobalObject")
    return true;
  // Forward-declared only: go by the name. JSDOMGlobalObject and
  // Zig::GlobalObject are global objects; GlobalObjectMethodTable is not.
  if (!RD->hasDefinition())
    return llvm::StringRef(name).ends_with("GlobalObject");
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
  Analyzer(ASTContext &Ctx, PathCache &paths, std::vector<Finding> &out)
      : m_ctx(Ctx), m_sm(Ctx.getSourceManager()), m_paths(paths),
        m_findings(out),
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
    if (!gOptions.exportSummaries.empty())
      summarize(FD);
  }

  // Summaries of functions with visible bodies, for --export-summaries.
  static bool matchesAny(const std::string &file,
                         const std::vector<std::string> &unders) {
    for (const std::string &u : unders)
      if (file.find(u) != std::string::npos)
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
      const std::string &file = m_paths.get(def->getLocation());
      if (file.empty() || !matchesAny(file, under) ||
          file.find("vendor/WebKit") != std::string::npos)
        continue;
      // The last column says whether the fallback classification already
      // gives this summary; the driver drops those rows from the committed
      // files. extern "C" functions never count: without a body they are
      // modeled as Rust-implemented conditional throwers, which is not what
      // a C++ body of theirs does.
      Summary fallback = fallbackSummary(FD);
      bool conventional = !FD->isExternC() && !s.consumesException &&
                          s.kind == fallback.kind &&
                          s.verifiesAtEntry == fallback.verifiesAtEntry &&
                          (s.kind != Summary::Transparent ||
                           s.exitStates == fallback.exitStates);
      os << mangledKey(FD) << "\t" << summaryKey(FD) << "\t"
         << Summary::kindName(s.kind) << "\t" << s.exitStates << "\t"
         << (s.verifiesAtEntry ? "1" : "0") << "\t" << s.why << "\t"
         << (conventional ? "1" : "0") << "\n";
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
      // RETURN_IF_EXCEPTION expands to
      //   EXCEPTION_ASSERT(!!scope.exception() == ...);
      //   if (vm.traps().maybeNeedHandling()) {
      //     if (vm.hasExceptionsAfterHandlingTraps()) return ...;
      //   }
      // In a debug build the assertion queries the exception on every path.
      // In a release build it is compiled out and only the trap-bit test is
      // left, so that test stands for the check: the macro means "return if
      // there is an exception" in both builds.
      if (MD->getIdentifier() && MD->getName() == "maybeNeedHandling" &&
          qualifiedName(MD->getParent()) == "JSC::VMTraps") {
        s.kind = Summary::Check;
        s.why = "RETURN_IF_EXCEPTION trap test";
        return s;
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

    return fallbackSummary(FD);
  }

  // The classification of a function nothing else knows about: no explicit
  // entry, no visible body, no imported summary. The export marks the rows
  // these rules already produce so the committed files can leave them out.
  static Summary fallbackSummary(const FunctionDecl *FD) {
    Summary s;

    // The JSC cell boilerplate: create(VM&, ...), createStructure(VM&, ...),
    // finishCreation(VM&, ...), createPrototype(VM&, ...) and the rest of
    // the family take a global object to install properties and structures,
    // and do not run JavaScript. The idiom is the VM& first parameter; the
    // functions of the same name that can throw take the global object
    // first (SerializedScriptValue::create(JSGlobalObject&, ...)).
    if (isCellBoilerplate(FD)) {
      s.kind = Summary::Nothrow;
      s.why = "no visible body; JSC cell boilerplate taking VM& first";
      return s;
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

  static bool isCellBoilerplate(const FunctionDecl *FD) {
    static const char *const names[] = {
        "create",          "createStructure",       "finishCreation",
        "createPrototype", "createConstructor",     "getConstructor",
        "prototype",       "prototypeForStructure", "getDOMStructure",
        "getDOMPrototype", "getDOMConstructor",     "initializeProperties",
        "subspaceFor",     "subspaceForImpl",
    };
    if (!FD->getIdentifier() || FD->getNumParams() == 0)
      return false;
    StringRef n = FD->getName();
    bool named = false;
    for (const char *name : names)
      if (n == name)
        named = true;
    if (!named)
      return false;
    QualType first = FD->getParamDecl(0)->getType();
    if (!first->isReferenceType())
      return false;
    const CXXRecordDecl *RD = first.getNonReferenceType()->getAsCXXRecordDecl();
    return RD && qualifiedName(RD) == "JSC::VM";
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
    f.loc = spelling;
    f.file = m_paths.get(spelling);
    if (f.file.empty())
      f.file = P.isValid() ? P.getFilename() : "<unknown>";
    f.line = P.isValid() ? P.getLine() : 0;
    f.col = P.isValid() ? P.getColumn() : 0;
    f.function = qualifiedName(FD);
    f.functionKey = signatureKey(FD);
    if (const auto *MD = dyn_cast<CXXMethodDecl>(FD))
      if (MD->getParent()->isLambda()) {
        f.function =
            "<lambda at " + locString(MD->getParent()->getLocation()) + ">";
        f.functionKey = f.function;
      }
    f.callee = stableCallee(callee);
    f.kind = kind;
    f.message = message;
    m_findings.push_back(std::move(f));
  }

  // The callee as it appears in a baseline key. `lastSource` strings carry
  // a "(file:line)" suffix for the message; the key must survive edits
  // elsewhere in the file.
  static std::string stableCallee(const std::string &callee) {
    static const std::string nested = "the nested ThrowScope declared at ";
    if (callee.rfind(nested, 0) == 0)
      return "nested ThrowScope";
    if (!callee.empty() && callee.back() == ')') {
      auto open = callee.rfind(" (");
      if (open != std::string::npos)
        return callee.substr(0, open);
    }
    return callee;
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

    // EXCEPTION_ASSERT(!!scope.exception() == ...) is how JSC code asserts
    // about the exception state, and RETURN_IF_EXCEPTION starts with one. In
    // a debug build it evaluates its argument, so the validator counts it as
    // a check; in a release build it expands to ((void)0). Treat the
    // expansion as a check in both, so the result does not depend on the
    // build type.
    if (isInExceptionAssertMacro(S)) {
      result.touchesException = true;
      return mapStates(
          in, [](unsigned st) { return st & ~(kPending | kThrown | kMaybe); });
    }

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
    if (gOptions.verbose) {
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
    return isInMacro(S, [](StringRef name) {
      return name.contains("RETURN_IF_EXCEPTION") ||
             name.contains("RETURN_IF_VM_EXCEPTION") ||
             name.contains("RETURN_STATUS_IF_EXCEPTION") ||
             name == "TRY_CLEAR_EXCEPTION";
    });
  }

  bool isInExceptionAssertMacro(const Stmt *S) {
    return isInMacro(S, [](StringRef name) {
      return name == "EXCEPTION_ASSERT" || name == "EXCEPTION_ASSERT_UNUSED" ||
             name == "EXCEPTION_ASSERT_WITH_MESSAGE";
    });
  }

  // Walks the macro expansions the statement's start came from, innermost
  // first, and reports whether one of them has a name `match` accepts.
  template <typename F> bool isInMacro(const Stmt *S, F match) {
    SourceLocation loc = S->getBeginLoc();
    while (loc.isMacroID()) {
      if (match(Lexer::getImmediateMacroName(loc, m_sm, m_ctx.getLangOpts())))
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
    gCfgCount++;
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
  PathCache &m_paths;
  std::vector<Finding> &m_findings;
  std::unique_ptr<ItaniumMangleContext> m_mangler;
  std::unordered_map<const FunctionDecl *, Summary> m_summaries;
  std::unordered_set<const FunctionDecl *> m_analyzed;
};

// Finds the lambdas inside one function body so their call operators can be
// analyzed as functions of their own.
class LambdaFinder : public RecursiveASTVisitor<LambdaFinder> {
public:
  std::vector<CXXMethodDecl *> found;
  bool VisitLambdaExpr(LambdaExpr *LE) {
    if (CXXMethodDecl *op = LE->getCallOperator())
      found.push_back(op);
    return true;
  }
};

// Walks the declaration tree of the translation unit and prunes every
// namespace, class and template that lives in a file we do not analyze or
// export (the WebKit headers are most of the tree). Function bodies are only
// walked for the functions that are analyzed.
class Walker {
public:
  Walker(ASTContext &Ctx, PathCache &paths, Analyzer &A, std::string onlyUnder,
         std::vector<std::string> exportUnder)
      : m_ctx(Ctx), m_sm(Ctx.getSourceManager()), m_paths(paths), m_analyzer(A),
        m_onlyUnder(std::move(onlyUnder)),
        m_exportUnder(std::move(exportUnder)) {}

  void run() { walkContext(m_ctx.getTranslationUnitDecl()); }

private:
  enum class Where { Skip, Analyze, Export };

  // One lookup per file instead of one per declaration.
  Where whereIs(SourceLocation loc) {
    loc = m_sm.getExpansionLoc(loc);
    if (loc.isInvalid())
      return Where::Skip;
    FileID fid = m_sm.getFileID(loc);
    auto it = m_fileKind.find(fid);
    if (it != m_fileKind.end())
      return it->second;
    Where w = Where::Skip;
    const std::string &file = m_paths.get(fid);
    if (!file.empty()) {
      if (file.find(m_onlyUnder) != std::string::npos)
        w = Where::Analyze;
      else if (!gOptions.exportSummaries.empty() &&
               Analyzer::matchesAny(file, m_exportUnder) &&
               file.find("vendor/WebKit") == std::string::npos)
        w = Where::Export;
    }
    m_fileKind[fid] = w;
    return w;
  }

  void walkContext(const DeclContext *DC) {
    for (Decl *D : DC->decls())
      walkDecl(D);
  }

  void walkDecl(Decl *D) {
    if (auto *FD = dyn_cast<FunctionDecl>(D)) {
      maybeAnalyze(FD);
      return;
    }
    if (auto *FT = dyn_cast<FunctionTemplateDecl>(D)) {
      if (whereIs(FT->getLocation()) == Where::Skip)
        return;
      for (FunctionDecl *spec : FT->specializations())
        maybeAnalyze(spec);
      return;
    }
    if (auto *CT = dyn_cast<ClassTemplateDecl>(D)) {
      if (whereIs(CT->getLocation()) == Where::Skip)
        return;
      for (ClassTemplateSpecializationDecl *spec : CT->specializations())
        walkContext(spec);
      return;
    }
    if (auto *RD = dyn_cast<CXXRecordDecl>(D)) {
      if (!RD->isThisDeclarationADefinition())
        return;
      if (whereIs(RD->getLocation()) == Where::Skip)
        return;
      walkContext(RD);
      return;
    }
    if (auto *NS = dyn_cast<NamespaceDecl>(D)) {
      if (whereIs(NS->getLocation()) == Where::Skip)
        return;
      walkContext(NS);
      return;
    }
    if (auto *LS = dyn_cast<LinkageSpecDecl>(D)) {
      if (whereIs(LS->getLocation()) == Where::Skip)
        return;
      walkContext(LS);
      return;
    }
  }

  void maybeAnalyze(FunctionDecl *FD) {
    if (!FD->doesThisDeclarationHaveABody() || !FD->getBody())
      return;
    if (FD->isDependentContext())
      return; // uninstantiated template pattern; specializations are walked
              // separately
    switch (whereIs(FD->getLocation())) {
    case Where::Skip:
      return;
    case Where::Analyze: {
      m_analyzer.analyzeFunction(FD);
      LambdaFinder finder;
      finder.TraverseStmt(FD->getBody());
      for (CXXMethodDecl *op : finder.found)
        if (op->doesThisDeclarationHaveABody() && op->getBody())
          m_analyzer.analyzeFunction(op);
      return;
    }
    case Where::Export:
      m_analyzer.summarizeForExport(FD);
      return;
    }
  }

  ASTContext &m_ctx;
  SourceManager &m_sm;
  PathCache &m_paths;
  Analyzer &m_analyzer;
  std::string m_onlyUnder;
  std::vector<std::string> m_exportUnder;
  std::map<FileID, Where> m_fileKind;
};

// Baseline: findings that are known and tolerated while they are being fixed.
// One per line: <file relative to root>\t<function>\t<kind>\t<callee>.
static std::set<std::string> gBaseline;

static void loadBaseline(const std::string &path) {
  if (path.empty())
    return;
  std::ifstream in(path);
  std::string line;
  while (std::getline(in, line)) {
    if (line.empty() || line[0] == '#')
      continue;
    gBaseline.insert(line);
  }
}

static std::string relativeToRoot(const std::string &file) {
  if (!gOptions.root.empty() && file.rfind(gOptions.root, 0) == 0) {
    std::string rel = file.substr(gOptions.root.size());
    if (!rel.empty() && rel[0] == '/')
      rel = rel.substr(1);
    return rel;
  }
  return file;
}

// A name as it appears in a baseline key: without its template arguments,
// so one entry covers every instantiation of a template (each translation
// unit may instantiate different ones). The markers that report() and
// describeCallee() write are not template arguments and stay:
// `<indirect call through get>` as it is, and `<lambda at file:line>` without
// the line number, so an edit above the lambda does not change the key. The
// lambdas of one file that share a function, kind and callee then share an
// entry.
static std::string stripTemplateArgs(const std::string &name) {
  std::string out;
  int depth = 0;
  for (size_t i = 0; i < name.size(); i++) {
    char c = name[i];
    bool lambda = name.compare(i, 8, "<lambda ") == 0;
    if (c == '<' && depth == 0 &&
        (lambda || name.compare(i, 10, "<indirect ") == 0)) {
      size_t close = name.find('>', i);
      if (close == std::string::npos)
        return name;
      size_t end = close;
      size_t colon = name.rfind(':', close);
      if (lambda && colon != std::string::npos && colon > i)
        end = colon;
      out += name.substr(i, end - i);
      out += '>';
      i = close;
      continue;
    }
    if (c == '<') {
      depth++;
      continue;
    }
    if (c == '>' && depth > 0) {
      depth--;
      continue;
    }
    if (depth == 0)
      out += c;
  }
  return depth == 0 ? out : name;
}

static std::string baselineKey(const Finding &f) {
  return relativeToRoot(f.file) + "\t" + stripTemplateArgs(f.functionKey) +
         "\t" + f.kind + "\t" + stripTemplateArgs(f.callee);
}

class Consumer : public ASTConsumer {
public:
  // `CI` is set in plugin mode: findings become compiler diagnostics. The
  // standalone tool prints them.
  explicit Consumer(CompilerInstance *CI = nullptr) : m_ci(CI) {}

  void HandleTranslationUnit(ASTContext &Ctx) override {
    // A translation unit that did not compile has an incomplete AST. The
    // compile fails on its own errors; findings on top would be noise.
    if (m_ci && m_ci->getDiagnostics().hasErrorOccurred())
      return;
    // The standalone tool handles many translation units in one process;
    // the timing line is per unit.
    gCfgCount = 0;
    auto started = std::chrono::steady_clock::now();
    std::vector<Finding> findings;
    PathCache paths(Ctx.getSourceManager());
    Analyzer analyzer(Ctx, paths, findings);
    std::vector<std::string> exportUnder = gOptions.exportUnder;
    if (exportUnder.empty())
      exportUnder.push_back("/src/");
    Walker walker(Ctx, paths, analyzer, gOptions.onlyUnder, exportUnder);
    walker.run();
    if (gOptions.time) {
      auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                    std::chrono::steady_clock::now() - started)
                    .count();
      llvm::errs() << "jsc-exception-lint: analysis " << ms << " ms, "
                   << gCfgCount << " cfgs\n";
    }

    if (!gOptions.exportSummaries.empty()) {
      std::error_code ec;
      llvm::raw_fd_ostream os(gOptions.exportSummaries, ec,
                              llvm::sys::fs::OF_Append |
                                  llvm::sys::fs::OF_Text);
      if (!ec)
        analyzer.exportSummaries(os, exportUnder);
    }

    // Dedupe (template instantiations report the same line many times).
    std::set<std::string> seen;
    std::set<std::string> usedBaseline;
    for (const Finding &f : findings) {
      std::string key = f.file + ":" + std::to_string(f.line) + ":" +
                        std::to_string(f.col) + ":" + f.kind + ":" + f.callee;
      if (!seen.insert(key).second)
        continue;
      if (m_ci) {
        // The compile fails on sure findings only. maybe-thrown-call marks
        // a call after a helper that may have thrown into our scope and
        // returned a failure value the caller usually tests, which the
        // analysis cannot see; the standalone tool shows them on request.
        //
        // A finding in a header is reported by every unit that produces
        // it, like a compiler warning in a header. Units see different
        // template instantiations, so no single unit sees them all.
        if (f.kind == "maybe-thrown-call")
          continue;
        std::string bkey = baselineKey(f);
        if (gBaseline.count(bkey)) {
          usedBaseline.insert(bkey);
          continue;
        }
        emit(f);
        continue;
      }
      if (gOptions.json) {
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
    if (m_ci)
      reportStaleBaseline(Ctx.getSourceManager(), usedBaseline);
    llvm::outs().flush();
  }

private:
  void emit(const Finding &f) {
    DiagnosticsEngine &diags = m_ci->getDiagnostics();
    unsigned id = diags.getCustomDiagID(
        gOptions.werror ? DiagnosticsEngine::Error : DiagnosticsEngine::Warning,
        "jsc-exception-lint: %0");
    diags.Report(f.loc, id) << f.message;
    // The key this finding has in baseline.tsv, for the case where it has
    // to be tolerated for a while (tabs shown as " | ").
    unsigned noteId = diags.getCustomDiagID(DiagnosticsEngine::Note,
                                            "in %0; baseline entry: %1");
    std::string key = baselineKey(f);
    size_t tab;
    while ((tab = key.find('\t')) != std::string::npos)
      key.replace(tab, 1, " | ");
    diags.Report(f.loc, noteId) << f.function << key;
  }

  // Baseline entries for a .cpp compiled in this unit that did not fire are
  // stale: the finding was fixed and the entry should go.
  void reportStaleBaseline(SourceManager &SM,
                           const std::set<std::string> &used) {
    if (gBaseline.empty())
      return;
    // Only the .cpp files matter: the entries below name .cpp files, and a
    // translation unit reads thousands of headers.
    std::set<std::string> filesHere;
    for (auto it = SM.fileinfo_begin(); it != SM.fileinfo_end(); ++it)
      if (it->first.getName().ends_with(".cpp"))
        filesHere.insert(relativeToRoot(realPathOf(it->first)));
    DiagnosticsEngine &diags = m_ci->getDiagnostics();
    unsigned id = diags.getCustomDiagID(
        DiagnosticsEngine::Warning,
        "jsc-exception-lint: baseline entry no longer fires, remove it: %0");
    for (const std::string &entry : gBaseline) {
      if (used.count(entry))
        continue;
      std::string file = entry.substr(0, entry.find('\t'));
      if (file.size() > 4 && file.compare(file.size() - 4, 4, ".cpp") == 0 &&
          filesHere.count(file))
        diags.Report(id) << entry;
    }
  }

  CompilerInstance *m_ci;
};

#ifdef JSC_EXCEPTION_LINT_PLUGIN

// Loaded into the compiler with -fplugin=. Arguments come in as
// -Xclang -plugin-arg-jsc-exception-lint -Xclang key=value. Paths are
// relative to the compiler's working directory (the build directory), so
// the command line is the same in every checkout and ccache entries are
// shared. `root` is the repository; functions defined under <root>/src/ are
// analyzed unless only-under says otherwise.
class PluginAction : public PluginASTAction {
protected:
  std::unique_ptr<ASTConsumer> CreateASTConsumer(CompilerInstance &CI,
                                                 StringRef) override {
    return std::make_unique<Consumer>(&CI);
  }

  bool ParseArgs(const CompilerInstance &CI,
                 const std::vector<std::string> &args) override {
    std::string onlyUnder;
    for (const std::string &arg : args) {
      auto eq = arg.find('=');
      std::string key = arg.substr(0, eq);
      std::string value = eq == std::string::npos ? "" : arg.substr(eq + 1);
      if (key == "nothrow")
        gOptions.nothrowFile = value;
      else if (key == "maythrow")
        gOptions.maythrowFile = value;
      else if (key == "import")
        gOptions.importSummaries.push_back(value);
      else if (key == "only-under")
        onlyUnder = value;
      else if (key == "root") {
        llvm::SmallString<256> real;
        if (llvm::sys::fs::real_path(value, real))
          real = value;
        gOptions.root = std::string(real);
      } else if (key == "baseline")
        gOptions.baselineFile = value;
      else if (key == "export")
        gOptions.exportSummaries = value;
      else if (key == "export-under")
        gOptions.exportUnder.push_back(value);
      else if (key == "werror")
        gOptions.werror = true;
      else if (key == "time")
        gOptions.time = true;
      else if (key == "verbose")
        gOptions.verbose = true;
      else if (key == "data-hash") {
        // A digest of the data files, put on the command line by the build
        // so that a compiler cache keyed on the command line misses when
        // they change. Nothing to do with it here.
      } else {
        DiagnosticsEngine &diags = CI.getDiagnostics();
        unsigned id = diags.getCustomDiagID(
            DiagnosticsEngine::Error,
            "jsc-exception-lint: unknown plugin argument '%0'");
        diags.Report(id) << arg;
        return false;
      }
    }
    if (!onlyUnder.empty())
      gOptions.onlyUnder = onlyUnder;
    else if (!gOptions.root.empty())
      gOptions.onlyUnder = gOptions.root + "/src/";
    loadList(gOptions.nothrowFile, Summary::Nothrow);
    loadList(gOptions.maythrowFile, Summary::MayThrow);
    for (const std::string &path : gOptions.importSummaries)
      loadSummaries(path);
    loadBaseline(gOptions.baselineFile);
    return true;
  }

  // Run after the main action so the object file is still produced.
  ActionType getActionType() override { return AddAfterMainAction; }
};

#else

class Action : public ASTFrontendAction {
public:
  std::unique_ptr<ASTConsumer> CreateASTConsumer(CompilerInstance &CI,
                                                 StringRef) override {
    // We only need the AST. Silence diagnostics from the huge header set.
    CI.getDiagnostics().setIgnoreAllWarnings(true);
    return std::make_unique<Consumer>();
  }
};

#endif

} // namespace

#ifdef JSC_EXCEPTION_LINT_PLUGIN

static FrontendPluginRegistry::Add<PluginAction>
    X("jsc-exception-lint", "check JavaScriptCore exception discipline");

#else

int main(int argc, const char **argv) {
  auto parser = CommonOptionsParser::create(argc, argv, Category);
  if (!parser) {
    llvm::errs() << llvm::toString(parser.takeError());
    return 1;
  }
  gOptions.nothrowFile = NothrowFile;
  gOptions.maythrowFile = ThrowFile;
  gOptions.onlyUnder = OnlyPathPrefix;
  gOptions.exportSummaries = ExportSummaries;
  gOptions.exportUnder.assign(ExportUnder.begin(), ExportUnder.end());
  gOptions.importSummaries.assign(ImportSummaries.begin(),
                                  ImportSummaries.end());
  gOptions.json = JsonOutput;
  gOptions.verbose = Verbose;
  gOptions.time = getenv("JSC_EXCEPTION_LINT_TIME") != nullptr;
  loadList(gOptions.nothrowFile, Summary::Nothrow);
  loadList(gOptions.maythrowFile, Summary::MayThrow);
  for (const std::string &path : gOptions.importSummaries)
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

#endif
