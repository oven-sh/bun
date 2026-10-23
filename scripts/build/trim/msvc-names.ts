// Reads the names that the Microsoft C++ ABI gives symbols, as LLVM's MicrosoftDemangle.cpp does: llvm-cxxfilt leaves them as they are.

const NoCallingConvention = 1;
const NoTagSpecifier = 2;
const NoAccessSpecifier = 4;
const NoMemberType = 8;
const NoReturnType = 16;
const NoVariableType = 32;
const nameAndParametersOnly =
  NoCallingConvention | NoTagSpecifier | NoAccessSpecifier | NoMemberType | NoReturnType | NoVariableType;

const Const = 1;
const Volatile = 2;
const Unaligned = 16;
const Restrict = 32;
const Pointer64 = 64;

const Public = 1;
const Protected = 2;
const Private = 4;
const Global = 8;
const Static = 16;
const Virtual = 32;
const Far = 64;
const ExternC = 128;
const NoParameterList = 256;
const VirtualThisAdjust = 512;
const VirtualThisAdjustEx = 1024;
const StaticThisAdjust = 2048;

const maxBackReferences = 10;
const largestSigned = (1n << 63n) - 1n;

class Output {
  text = "";

  spaceIfNecessary(): void {
    if (/[0-9A-Za-z>]$/.test(this.text)) this.text += " ";
  }

  qualifiers(qualifiers: number, spaceBefore: boolean, spaceAfter: boolean): void {
    const words = [
      ...(qualifiers & Const ? ["const"] : []),
      ...(qualifiers & Volatile ? ["volatile"] : []),
      ...(qualifiers & Restrict ? ["__restrict"] : []),
    ];
    if (words.length === 0) return;
    this.text += (spaceBefore ? " " : "") + words.join(" ") + (spaceAfter ? " " : "");
  }

  callingConvention(convention: string): void {
    this.spaceIfNecessary();
    this.text += convention;
  }

  list(nodes: readonly Node[], flags: number, separator: string): void {
    nodes.forEach((node, index) => {
      if (index > 0) this.text += separator;
      node.output(this, flags);
    });
  }
}

interface Node {
  output(out: Output, flags: number): void;
}

abstract class Type implements Node {
  qualifiers = 0;
  abstract outputPre(out: Output, flags: number): void;
  abstract outputPost(out: Output, flags: number): void;

  output(out: Output, flags: number): void {
    this.outputPre(out, flags);
    this.outputPost(out, flags);
  }
}

class PrimitiveType extends Type {
  name: string;

  constructor(name: string) {
    super();
    this.name = name;
  }

  outputPre(out: Output): void {
    out.text += this.name;
    out.qualifiers(this.qualifiers, true, false);
  }

  outputPost(): void {}
}

class TagType extends Type {
  tag: string;
  name: QualifiedName;

  constructor(tag: string, name: QualifiedName) {
    super();
    this.tag = tag;
    this.name = name;
  }

  outputPre(out: Output, flags: number): void {
    if (!(flags & NoTagSpecifier)) out.text += this.tag + " ";
    this.name.output(out, flags);
    out.qualifiers(this.qualifiers, true, false);
  }

  outputPost(): void {}
}

class CustomType extends Type {
  identifier: Identifier;

  constructor(identifier: Identifier) {
    super();
    this.identifier = identifier;
  }

  outputPre(out: Output, flags: number): void {
    this.identifier.output(out, flags);
  }

  outputPost(): void {}
}

class ArrayType extends Type {
  dimensions: bigint[];
  element: Type;

  constructor(dimensions: bigint[], element: Type) {
    super();
    this.dimensions = dimensions;
    this.element = element;
  }

  outputPre(out: Output, flags: number): void {
    this.element.outputPre(out, flags);
    out.qualifiers(this.qualifiers, true, false);
  }

  outputPost(out: Output, flags: number): void {
    out.text += "[" + this.dimensions.map(dimension => (dimension === 0n ? "" : String(dimension))).join("][") + "]";
    this.element.outputPost(out, flags);
  }
}

class FunctionSignature extends Type {
  functionClass = 0;
  callingConvention = "";
  referenceQualifier = "";
  returnType: Type | undefined;
  parameters: Type[] | undefined;
  isVariadic = false;
  isNoexcept = false;

  override output(out: Output, flags: number): void {
    super.output(out, flags & ~NoReturnType);
  }

  outputPre(out: Output, flags: number): void {
    const functionClass = this.functionClass;
    if (!(flags & NoAccessSpecifier)) {
      if (functionClass & Public) out.text += "public: ";
      if (functionClass & Protected) out.text += "protected: ";
      if (functionClass & Private) out.text += "private: ";
    }
    if (!(flags & NoMemberType)) {
      if (!(functionClass & Global) && functionClass & Static) out.text += "static ";
      if (functionClass & Virtual) out.text += "virtual ";
      if (functionClass & ExternC) out.text += 'extern "C" ';
    }
    if (!(flags & NoReturnType) && this.returnType !== undefined) {
      this.returnType.outputPre(out, flags);
      out.text += " ";
    }
    if (!(flags & NoCallingConvention)) out.callingConvention(this.callingConvention);
  }

  outputPost(out: Output, flags: number): void {
    if (!(this.functionClass & NoParameterList)) {
      out.text += "(";
      if (this.parameters !== undefined) out.list(this.parameters, flags, ", ");
      else out.text += "void";
      if (this.isVariadic) out.text += out.text.endsWith("(") ? "..." : ", ...";
      out.text += ")";
    }
    if (this.qualifiers & Const) out.text += " const";
    if (this.qualifiers & Volatile) out.text += " volatile";
    if (this.qualifiers & Restrict) out.text += " __restrict";
    if (this.qualifiers & Unaligned) out.text += " __unaligned";
    if (this.isNoexcept) out.text += " noexcept";
    out.text += this.referenceQualifier;
    if (!(flags & NoReturnType)) this.returnType?.outputPost(out, flags);
  }
}

class ThunkSignature extends FunctionSignature {
  staticOffset = 0n;
  virtualBasePointerOffset = 0n;
  virtualBaseOffsetOffset = 0n;
  vtordispOffset = 0n;

  override outputPre(out: Output, flags: number): void {
    out.text += "[thunk]: ";
    super.outputPre(out, flags);
  }

  override outputPost(out: Output, flags: number): void {
    if (this.functionClass & StaticThisAdjust) out.text += `\`adjustor{${this.staticOffset}}'`;
    else if (this.functionClass & VirtualThisAdjustEx)
      out.text += `\`vtordispex{${this.virtualBasePointerOffset}, ${this.virtualBaseOffsetOffset}, ${this.vtordispOffset}, ${this.staticOffset}}'`;
    else if (this.functionClass & VirtualThisAdjust)
      out.text += `\`vtordisp{${this.vtordispOffset}, ${this.staticOffset}}'`;
    super.outputPost(out, flags);
  }
}

class PointerType extends Type {
  affinity = "*";
  classParent: QualifiedName | undefined;
  pointee!: Type;

  outputPre(out: Output, flags: number): void {
    const { pointee } = this;
    if (pointee instanceof FunctionSignature) pointee.outputPre(out, NoCallingConvention | (flags & NoTagSpecifier));
    else pointee.outputPre(out, flags);
    out.spaceIfNecessary();
    if (this.qualifiers & Unaligned) out.text += "__unaligned ";
    if (pointee instanceof ArrayType) out.text += "(";
    else if (pointee instanceof FunctionSignature) {
      out.text += "(";
      if (!(flags & NoCallingConvention)) out.text += pointee.callingConvention + " ";
    }
    if (this.classParent !== undefined) {
      this.classParent.output(out, flags);
      out.text += "::";
    }
    out.text += this.affinity;
    out.qualifiers(this.qualifiers, false, false);
  }

  outputPost(out: Output, flags: number): void {
    if (this.pointee instanceof ArrayType || this.pointee instanceof FunctionSignature) out.text += ")";
    this.pointee.outputPost(out, this.pointee instanceof FunctionSignature ? flags & ~NoReturnType : flags);
  }
}

abstract class Identifier implements Node {
  templateParameters: Node[] | undefined;
  abstract output(out: Output, flags: number): void;

  outputTemplateParameters(out: Output, flags: number): void {
    if (this.templateParameters === undefined) return;
    out.text += "<";
    out.list(this.templateParameters, flags, ", ");
    out.text += ">";
  }
}

class NamedIdentifier extends Identifier {
  name: string;
  private readonly spelled: Identifier | undefined;

  constructor(name: string, spelled?: Identifier) {
    super();
    this.name = name;
    this.spelled = spelled;
  }

  output(out: Output, flags: number): void {
    if (this.spelled === undefined) out.text += this.name;
    else this.spelled.output(out, flags);
    this.outputTemplateParameters(out, flags);
  }
}

class StructorIdentifier extends Identifier {
  isDestructor: boolean;
  enclosingClass: Identifier | undefined;

  constructor(isDestructor: boolean) {
    super();
    this.isDestructor = isDestructor;
  }

  output(out: Output, flags: number): void {
    if (this.isDestructor) out.text += "~";
    this.enclosingClass!.output(out, flags);
    this.outputTemplateParameters(out, flags);
  }
}

class ConversionOperatorIdentifier extends Identifier {
  targetType: Type | undefined;

  output(out: Output, flags: number): void {
    out.text += "operator";
    this.outputTemplateParameters(out, flags);
    out.text += " ";
    this.targetType!.output(out, flags);
  }
}

class LocalStaticGuardIdentifier extends Identifier {
  isThread: boolean;
  scopeIndex = 0n;

  constructor(isThread: boolean) {
    super();
    this.isThread = isThread;
  }

  output(out: Output): void {
    out.text += this.isThread ? "`local static thread guard'" : "`local static guard'";
    if (this.scopeIndex > 0n) out.text += `{${this.scopeIndex}}`;
  }
}

class DynamicStructorIdentifier extends Identifier {
  isDestructor: boolean;
  variable: VariableSymbol | undefined;
  name: QualifiedName | undefined;

  constructor(isDestructor: boolean) {
    super();
    this.isDestructor = isDestructor;
  }

  output(out: Output, flags: number): void {
    out.text += this.isDestructor ? "`dynamic atexit destructor for " : "`dynamic initializer for ";
    out.text += this.variable !== undefined ? "`" : "'";
    (this.variable ?? this.name!).output(out, flags);
    out.text += "''";
  }
}

class QualifiedName implements Node {
  components: Identifier[];

  constructor(components: Identifier[]) {
    this.components = components;
  }

  get unqualified(): Identifier {
    return this.components.at(-1)!;
  }

  output(out: Output, flags: number): void {
    out.list(this.components, flags, "::");
  }
}

class IntegerLiteral implements Node {
  text: string;

  constructor(value: bigint, isNegative: boolean) {
    this.text = (isNegative ? "-" : "") + value;
  }

  output(out: Output): void {
    out.text += this.text;
  }
}

class TemplateParameterReference implements Node {
  symbol: NamedSymbol | undefined;
  thunkOffsets: bigint[] = [];
  isPointer = false;

  output(out: Output, flags: number): void {
    const hasOffsets = this.thunkOffsets.length > 0;
    if (hasOffsets) out.text += "{";
    else if (this.isPointer) out.text += "&";
    if (this.symbol !== undefined) {
      this.symbol.output(out, flags);
      if (hasOffsets) out.text += ", ";
    }
    out.text += this.thunkOffsets.join(", ");
    if (hasOffsets) out.text += "}";
  }
}

abstract class NamedSymbol implements Node {
  name!: QualifiedName;

  output(out: Output, flags: number): void {
    this.name.output(out, flags);
  }
}

class LocalStaticGuardVariable extends NamedSymbol {}

class FunctionSymbol extends NamedSymbol {
  signature: FunctionSignature;

  constructor(signature: FunctionSignature) {
    super();
    this.signature = signature;
  }

  override output(out: Output, flags: number): void {
    this.signature.outputPre(out, flags);
    out.spaceIfNecessary();
    this.name.output(out, flags);
    this.signature.outputPost(out, flags);
  }
}

class VariableSymbol extends NamedSymbol {
  access: string | undefined;
  type: Type | undefined;

  override output(out: Output, flags: number): void {
    if (!(flags & NoAccessSpecifier) && this.access !== undefined) out.text += this.access + ": ";
    if (!(flags & NoMemberType) && this.access !== undefined) out.text += "static ";
    const type = flags & NoVariableType ? undefined : this.type;
    if (type !== undefined) {
      type.outputPre(out, flags);
      out.spaceIfNecessary();
    }
    this.name.output(out, flags);
    type?.outputPost(out, flags);
  }
}

class SpecialTableSymbol extends NamedSymbol {
  qualifiers = 0;
  targetName: QualifiedName | undefined;

  override output(out: Output, flags: number): void {
    out.qualifiers(this.qualifiers, false, true);
    this.name.output(out, flags);
    if (this.targetName === undefined) return;
    out.text += "{for `";
    this.targetName.output(out, flags);
    out.text += "'}";
  }
}

const codes = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const operators = {
  "": [
    ...[undefined, undefined, "operator new", "operator delete", "operator=", "operator>>", "operator<<", "operator!"],
    ...["operator==", "operator!=", "operator[]", undefined, "operator->", "operator*", "operator++", "operator--"],
    ...["operator-", "operator+", "operator&", "operator->*", "operator/", "operator%", "operator<", "operator<="],
    ...["operator>", "operator>=", "operator,", "operator()", "operator~", "operator^", "operator|", "operator&&"],
    ...["operator||", "operator*=", "operator+=", "operator-="],
  ],
  "_": [
    ...["operator/=", "operator%=", "operator>>=", "operator<<=", "operator&=", "operator|=", "operator^="],
    ...[undefined, undefined, undefined, undefined, undefined, undefined],
    ...["`vbase dtor'", "`vector deleting dtor'", "`default ctor closure'", "`scalar deleting dtor'"],
    ...["`vector ctor iterator'", "`vector dtor iterator'", "`vector vbase ctor iterator'"],
    ...["`virtual displacement map'", "`eh vector ctor iterator'", "`eh vector dtor iterator'"],
    ...["`eh vector vbase ctor iterator'", "`copy ctor closure'", undefined, undefined, undefined, undefined],
    ...["`local vftable ctor closure'", "operator new[]", "operator delete[]"],
  ],
  "__": [
    ...[undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined],
    ...["`managed vector ctor iterator'", "`managed vector dtor iterator'", "`EH vector copy ctor iterator'"],
    ...["`EH vector vbase copy ctor iterator'", undefined, undefined, "`vector copy ctor iterator'"],
    ...["`vector vbase copy constructor iterator'", "`managed vector vbase copy constructor iterator'"],
    ...[undefined, undefined, "operator co_await", "operator<=>"],
  ],
} satisfies Record<string, (string | undefined)[]>;

const primitiveTypes = new Map(
  Object.entries({
    X: "void",
    D: "char",
    C: "signed char",
    E: "unsigned char",
    F: "short",
    G: "unsigned short",
    H: "int",
    I: "unsigned int",
    J: "long",
    K: "unsigned long",
    M: "float",
    N: "double",
    O: "long double",
    _N: "bool",
    _J: "__int64",
    _K: "unsigned __int64",
    _W: "wchar_t",
    _Q: "char8_t",
    _S: "char16_t",
    _U: "char32_t",
    _P: "auto",
    _T: "decltype(auto)",
  }),
);

const callingConventions = new Map(
  Object.entries({
    A: "__cdecl",
    B: "__cdecl",
    C: "__pascal",
    D: "__pascal",
    E: "__thiscall",
    F: "__thiscall",
    G: "__stdcall",
    H: "__stdcall",
    I: "__fastcall",
    J: "__fastcall",
    M: "__clrcall",
    N: "__clrcall",
    O: "__eabi",
    P: "__eabi",
    Q: "__vectorcall",
    S: "__attribute__((__swiftcall__)) ",
    W: "__attribute__((__swiftasynccall__)) ",
  }),
);

const functionClasses = new Map<string, number>([
  ["9", ExternC | NoParameterList],
  ...[Private, Protected, Public].flatMap((access, index): [string, number][] => {
    const adjusts = access === Private ? StaticThisAdjust : Virtual | StaticThisAdjust;
    return [0, Static, Virtual, adjusts].flatMap((kind, at): [string, number][] => [
      [String.fromCharCode(65 + 8 * index + 2 * at), access | kind],
      [String.fromCharCode(66 + 8 * index + 2 * at), access | kind | Far],
    ]);
  }),
  ["Y", Global],
  ["Z", Global | Far],
]);

const specialTables = new Map([
  ["?_7", "`vftable'"],
  ["?_8", "`vbtable'"],
  ["?_S", "`local vftable'"],
  ["?_R4", "`RTTI Complete Object Locator'"],
]);

const untypedVariables = new Map([
  ["?_R2", "`RTTI Base Class Array'"],
  ["?_R3", "`RTTI Class Hierarchy Descriptor'"],
]);

const unread = new Error("not a name that this reader reads");

interface BackReferences {
  names: NamedIdentifier[];
  functionParameters: Type[];
}

type QualifierMangling = "Drop" | "Mangle" | "Result";

class Reader {
  private text: string;
  private at = 0;
  private backReferences: BackReferences = { names: [], functionParameters: [] };

  constructor(text: string) {
    this.text = text;
  }

  private get isAtEnd(): boolean {
    return this.at >= this.text.length;
  }

  private startsWith(prefix: string): boolean {
    return this.text.startsWith(prefix, this.at);
  }

  private startsWithDigit(): boolean {
    const code = this.text.charCodeAt(this.at);
    return code >= 48 && code <= 57;
  }

  private consume(prefix: string): boolean {
    if (!this.startsWith(prefix)) return false;
    this.at += prefix.length;
    return true;
  }

  private expect(prefix: string): void {
    if (!this.consume(prefix)) throw unread;
  }

  private next(): string {
    if (this.isAtEnd) throw unread;
    return this.text[this.at++]!;
  }

  readSymbol(): NamedSymbol {
    if (this.startsWith("??@") || this.startsWith("??_C")) throw unread;
    this.expect("?");
    return this.readSpecialSymbol() ?? this.readDeclarator();
  }

  private readSpecialSymbol(): NamedSymbol | undefined {
    for (const [code, name] of specialTables) if (this.consume(code)) return this.readSpecialTable(name);
    for (const [code, name] of untypedVariables) {
      if (!this.consume(code)) continue;
      const variable = new VariableSymbol();
      variable.name = this.readScopeChain(new NamedIdentifier(name));
      this.expect("8");
      return variable;
    }
    if (this.consume("?_9")) return this.readVirtualCallThunk();
    if (this.consume("?_B")) return this.readLocalStaticGuard(false);
    if (this.consume("?__J")) return this.readLocalStaticGuard(true);
    if (this.consume("?_R0")) return this.readTypeDescriptor();
    if (this.consume("?_R1")) return this.readBaseClassDescriptor();
    if (this.consume("?__E")) return this.readDynamicStructor(false);
    if (this.consume("?__F")) return this.readDynamicStructor(true);
    if (this.startsWith("?_A") || this.startsWith("?_P")) throw unread;
    return undefined;
  }

  private readSpecialTable(name: string): SpecialTableSymbol {
    const table = new SpecialTableSymbol();
    table.name = this.readScopeChain(new NamedIdentifier(name));
    const kind = this.next();
    if (kind !== "6" && kind !== "7") throw unread;
    table.qualifiers = this.readQualifiers().qualifiers;
    if (!this.consume("@")) table.targetName = this.readQualifiedTypeName();
    return table;
  }

  private readVirtualCallThunk(): FunctionSymbol {
    const thunk = new FunctionSymbol(new ThunkSignature());
    thunk.signature.functionClass = NoParameterList;
    const identifier = new NamedIdentifier("");
    thunk.name = this.readScopeChain(identifier);
    this.expect("$B");
    identifier.name = `\`vcall'{${this.readUnsigned()}, {flat}}`;
    this.expect("A");
    thunk.signature.callingConvention = this.readCallingConvention();
    return thunk;
  }

  private readLocalStaticGuard(isThread: boolean): LocalStaticGuardVariable {
    const identifier = new LocalStaticGuardIdentifier(isThread);
    const guard = new LocalStaticGuardVariable();
    guard.name = this.readScopeChain(identifier);
    if (!this.consume("4IA")) this.expect("5");
    if (!this.isAtEnd) identifier.scopeIndex = this.readUnsigned();
    return guard;
  }

  private readTypeDescriptor(): VariableSymbol {
    const variable = new VariableSymbol();
    variable.type = this.readType("Result");
    this.expect("@8");
    if (!this.isAtEnd) throw unread;
    variable.name = new QualifiedName([new NamedIdentifier("`RTTI Type Descriptor'")]);
    return variable;
  }

  private readBaseClassDescriptor(): VariableSymbol {
    const offsets = [this.readUnsigned(), this.readSigned(), this.readUnsigned(), this.readUnsigned()];
    const variable = new VariableSymbol();
    variable.name = this.readScopeChain(
      new NamedIdentifier(`\`RTTI Base Class Descriptor at (${offsets.join(", ")})'`),
    );
    this.consume("8");
    return variable;
  }

  private readDynamicStructor(isDestructor: boolean): FunctionSymbol {
    const identifier = new DynamicStructorIdentifier(isDestructor);
    const isStaticDataMember = this.consume("?");
    const symbol = this.readDeclarator();
    let stub: FunctionSymbol;
    if (symbol instanceof VariableSymbol) {
      identifier.variable = symbol;
      this.expect(isStaticDataMember ? "@@" : "@");
      stub = this.readFunctionEncoding();
    } else if (symbol instanceof FunctionSymbol && !isStaticDataMember) {
      identifier.name = symbol.name;
      stub = symbol;
    } else throw unread;
    stub.name = new QualifiedName([identifier]);
    return stub;
  }

  private readDeclarator(): NamedSymbol {
    const name = this.readQualifiedSymbolName();
    const symbol = this.readEncodedSymbol(name);
    symbol.name = name;
    const { unqualified } = name;
    if (unqualified instanceof ConversionOperatorIdentifier && unqualified.targetType === undefined) throw unread;
    return symbol;
  }

  private readEncodedSymbol(name: QualifiedName): NamedSymbol {
    if (this.isAtEnd) throw unread;
    if ("01234".includes(this.text[this.at]!)) return this.readVariableEncoding();
    const symbol = this.readFunctionEncoding();
    const { unqualified } = name;
    if (unqualified instanceof ConversionOperatorIdentifier) unqualified.targetType = symbol.signature.returnType;
    return symbol;
  }

  private readVariableEncoding(): VariableSymbol {
    const variable = new VariableSymbol();
    variable.access = ["private", "protected", "public", undefined, undefined][Number(this.next())];
    const type = this.readType("Drop");
    variable.type = type;
    if (type instanceof PointerType) {
      type.qualifiers |= this.readPointerExtendedQualifiers();
      const { qualifiers } = this.readQualifiers();
      if (type.classParent !== undefined) this.readQualifiedTypeName();
      type.pointee.qualifiers |= qualifiers;
    } else type.qualifiers = this.readQualifiers().qualifiers;
    return variable;
  }

  private readFunctionEncoding(): FunctionSymbol {
    const isExternC = this.consume("$$J0");
    const functionClass = this.readFunctionClass() | (isExternC ? ExternC : 0);
    let thunk: ThunkSignature | undefined;
    if (functionClass & StaticThisAdjust) {
      thunk = new ThunkSignature();
      thunk.staticOffset = BigInt.asUintN(32, this.readSigned());
    } else if (functionClass & VirtualThisAdjust) {
      thunk = new ThunkSignature();
      if (functionClass & VirtualThisAdjustEx) {
        thunk.virtualBasePointerOffset = BigInt.asIntN(32, this.readSigned());
        thunk.virtualBaseOffsetOffset = BigInt.asIntN(32, this.readSigned());
      }
      thunk.vtordispOffset = BigInt.asIntN(32, this.readSigned());
      thunk.staticOffset = BigInt.asUintN(32, this.readSigned());
    }
    const signature = thunk ?? new FunctionSignature();
    if (!(functionClass & NoParameterList)) this.readFunctionType(signature, !(functionClass & (Global | Static)));
    signature.functionClass = functionClass;
    return new FunctionSymbol(signature);
  }

  private readFunctionClass(): number {
    const code = this.next();
    if (code !== "$") return functionClasses.get(code) ?? this.fail();
    const adjusts = VirtualThisAdjust | (this.consume("R") ? VirtualThisAdjustEx : 0);
    const access = "012345".indexOf(this.next());
    if (access < 0) throw unread;
    return [Private, Protected, Public][access >> 1]! | Virtual | adjusts | (access & 1 ? Far : 0);
  }

  private fail(): never {
    throw unread;
  }

  private readFunctionType(signature: FunctionSignature, hasThisQualifiers: boolean): FunctionSignature {
    if (hasThisQualifiers) {
      signature.qualifiers = this.readPointerExtendedQualifiers();
      signature.referenceQualifier = this.consume("G") ? " &" : this.consume("H") ? " &&" : "";
      signature.qualifiers |= this.readQualifiers().qualifiers;
    }
    signature.callingConvention = this.readCallingConvention();
    if (!this.consume("@")) signature.returnType = this.readType("Result");
    this.readFunctionParameters(signature);
    if (this.consume("_E")) signature.isNoexcept = true;
    else this.expect("Z");
    return signature;
  }

  private readCallingConvention(): string {
    return callingConventions.get(this.next()) ?? "";
  }

  private readFunctionParameters(signature: FunctionSignature): void {
    if (this.consume("X")) return;
    const parameters: Type[] = [];
    const remembered = this.backReferences.functionParameters;
    while (!this.startsWith("@") && !this.startsWith("Z")) {
      if (this.startsWithDigit()) {
        parameters.push(remembered[Number(this.next())] ?? this.fail());
        continue;
      }
      const start = this.at;
      const type = this.readType("Drop");
      parameters.push(type);
      if (remembered.length < maxBackReferences && this.at - start > 1) remembered.push(type);
    }
    signature.parameters = parameters;
    if (this.consume("@")) return;
    this.expect("Z");
    signature.isVariadic = true;
  }

  private readPointerExtendedQualifiers(): number {
    return (
      (this.consume("E") ? Pointer64 : 0) | (this.consume("I") ? Restrict : 0) | (this.consume("F") ? Unaligned : 0)
    );
  }

  private readQualifiers(): { qualifiers: number; isMember: boolean } {
    const code = "ABCDQRST".indexOf(this.next());
    if (code < 0) throw unread;
    return { qualifiers: code & 3, isMember: code >= 4 };
  }

  private readType(mangling: QualifierMangling): Type {
    let qualifiers = 0;
    if (mangling === "Mangle" || (mangling === "Result" && this.consume("?")))
      qualifiers = this.readQualifiers().qualifiers;
    if (this.isAtEnd) throw unread;
    const type = this.readUnqualifiedType();
    type.qualifiers |= qualifiers;
    return type;
  }

  private readUnqualifiedType(): Type {
    const first = this.text[this.at]!;
    if ("TUVW".includes(first)) return this.readTagType();
    if (this.startsWith("$$Q") || "APQRS".includes(first))
      return this.isMemberPointer() ? this.readMemberPointerType() : this.readPointerType();
    if (first === "Y") return this.readArrayType();
    if (this.consume("$$A8@@")) return this.readFunctionType(new FunctionSignature(), true);
    if (this.consume("$$A6")) return this.readFunctionType(new FunctionSignature(), false);
    if (this.consume("?")) {
      const type = new CustomType(this.readUnqualifiedTypeName(true));
      this.expect("@");
      return type;
    }
    if (this.consume("$$T")) return new PrimitiveType("std::nullptr_t");
    const code = this.next();
    return new PrimitiveType(primitiveTypes.get(code === "_" ? code + this.next() : code) ?? this.fail());
  }

  private readTagType(): TagType {
    const code = this.next();
    if (code === "W") this.expect("4");
    const tag = { T: "union", U: "struct", V: "class", W: "enum" }[code as "T" | "U" | "V" | "W"];
    return new TagType(tag, this.readQualifiedTypeName());
  }

  private isMemberPointer(): boolean {
    const first = this.text[this.at]!;
    if (first === "$" || first === "A") return false;
    let at = this.at + 1;
    const digit = this.text[at];
    if (digit !== undefined && digit >= "0" && digit <= "9") {
      if (digit !== "6" && digit !== "8") throw unread;
      return digit === "8";
    }
    for (const qualifier of "EIF") if (this.text[at] === qualifier) at++;
    const code = "ABCDQRST".indexOf(this.text[at] ?? " ");
    if (code < 0) throw unread;
    return code >= 4;
  }

  private readPointerQualifiers(pointer: PointerType): void {
    if (this.consume("$$Q")) {
      pointer.affinity = "&&";
      return;
    }
    const code = this.next();
    if (code === "A") pointer.affinity = "&";
    else pointer.qualifiers = "PQRS".indexOf(code);
  }

  private readPointerType(): PointerType {
    const pointer = new PointerType();
    this.readPointerQualifiers(pointer);
    if (this.consume("6")) {
      pointer.pointee = this.readFunctionType(new FunctionSignature(), false);
      return pointer;
    }
    pointer.qualifiers |= this.readPointerExtendedQualifiers();
    pointer.pointee = this.readType("Mangle");
    return pointer;
  }

  private readMemberPointerType(): PointerType {
    const pointer = new PointerType();
    this.readPointerQualifiers(pointer);
    pointer.qualifiers |= this.readPointerExtendedQualifiers();
    if (this.consume("8")) {
      pointer.classParent = this.readQualifiedTypeName();
      pointer.pointee = this.readFunctionType(new FunctionSignature(), true);
      return pointer;
    }
    const { qualifiers } = this.readQualifiers();
    pointer.classParent = this.readQualifiedTypeName();
    pointer.pointee = this.readType("Drop");
    pointer.pointee.qualifiers = qualifiers;
    return pointer;
  }

  private readArrayType(): ArrayType {
    this.expect("Y");
    const rank = this.readUnsigned();
    if (rank === 0n) throw unread;
    const dimensions: bigint[] = [];
    for (let index = 0n; index < rank; index++) dimensions.push(this.readUnsigned());
    let qualifiers = 0;
    if (this.consume("$$C")) {
      const read = this.readQualifiers();
      if (read.isMember) throw unread;
      qualifiers = read.qualifiers;
    }
    const array = new ArrayType(dimensions, this.readType("Drop"));
    array.qualifiers = qualifiers;
    return array;
  }

  private readNumber(): { value: bigint; isNegative: boolean } {
    const isNegative = this.consume("?");
    if (this.startsWithDigit()) return { value: BigInt(this.next()) + 1n, isNegative };
    let value = 0n;
    for (;;) {
      const code = this.next().charCodeAt(0);
      if (code === 64) return { value: BigInt.asUintN(64, value), isNegative };
      if (code < 65 || code > 80) throw unread;
      value = (value << 4n) + BigInt(code - 65);
    }
  }

  private readUnsigned(): bigint {
    const { value, isNegative } = this.readNumber();
    if (isNegative) throw unread;
    return value;
  }

  private readSigned(): bigint {
    const { value, isNegative } = this.readNumber();
    if (value > largestSigned) throw unread;
    return isNegative ? -value : value;
  }

  private remember(name: string, spelled?: Identifier): void {
    const { names } = this.backReferences;
    if (names.length >= maxBackReferences || names.some(known => known.name === name)) return;
    names.push(new NamedIdentifier(name, spelled));
  }

  private rememberIdentifier(identifier: Identifier): void {
    const out = new Output();
    identifier.output(out, 0);
    this.remember(out.text, identifier);
  }

  private readBackReference(): NamedIdentifier {
    return this.backReferences.names[Number(this.next())] ?? this.fail();
  }

  private readSimpleString(remembers: boolean): string {
    const end = this.text.indexOf("@", this.at);
    if (end <= this.at) throw unread;
    const name = this.text.slice(this.at, end);
    this.at = end + 1;
    if (remembers) this.remember(name);
    return name;
  }

  private readQualifiedTypeName(): QualifiedName {
    return this.readScopeChain(this.readUnqualifiedTypeName(true));
  }

  private readQualifiedSymbolName(): QualifiedName {
    const identifier = this.readUnqualifiedSymbolName(true, false);
    const name = this.readScopeChain(identifier);
    if (identifier instanceof StructorIdentifier) identifier.enclosingClass = name.components.at(-2) ?? this.fail();
    return name;
  }

  private readUnqualifiedTypeName(remembers: boolean): Identifier {
    if (this.startsWithDigit()) return this.readBackReference();
    if (this.startsWith("?$")) return this.readTemplateInstantiation(true);
    return new NamedIdentifier(this.readSimpleString(remembers));
  }

  private readUnqualifiedSymbolName(remembersSimple: boolean, remembersTemplate: boolean): Identifier {
    if (this.startsWithDigit()) return this.readBackReference();
    if (this.startsWith("?$")) return this.readTemplateInstantiation(remembersTemplate);
    if (this.consume("?")) return this.readFunctionIdentifier();
    return new NamedIdentifier(this.readSimpleString(remembersSimple));
  }

  private readFunctionIdentifier(): Identifier {
    const group = this.consume("__") ? "__" : this.consume("_") ? "_" : "";
    const code = this.next();
    if (group === "" && (code === "0" || code === "1")) return new StructorIdentifier(code === "1");
    if (group === "" && code === "B") return new ConversionOperatorIdentifier();
    if (group === "__" && code === "K") return new NamedIdentifier('operator ""' + this.readSimpleString(false));
    const index = codes.indexOf(code);
    if (index < 0) throw unread;
    return new NamedIdentifier(operators[group][index] ?? "");
  }

  private readScopePiece(): Identifier {
    if (this.startsWithDigit()) return this.readBackReference();
    if (this.startsWith("?$")) return this.readTemplateInstantiation(true);
    if (this.consume("?A")) {
      const end = this.text.indexOf("@", this.at);
      if (end < 0) throw unread;
      this.remember(this.text.slice(this.at, end));
      this.at = end + 1;
      return new NamedIdentifier("`anonymous namespace'");
    }
    if (/^\?(?:[@0-9]|[B-P][A-P]*@)\?/.test(this.text.slice(this.at, this.at + 24))) return this.readLocalScope();
    return new NamedIdentifier(this.readSimpleString(true));
  }

  private readLocalScope(): NamedIdentifier {
    this.expect("?");
    const { value } = this.readNumber();
    this.consume("?");
    const out = new Output();
    this.readSymbol().output(out, 0);
    return new NamedIdentifier(`\`${out.text}'::\`${value}'`);
  }

  private readScopeChain(unqualified: Identifier): QualifiedName {
    const components = [unqualified];
    while (!this.consume("@")) {
      if (this.isAtEnd) throw unread;
      components.unshift(this.readScopePiece());
    }
    return new QualifiedName(components);
  }

  private readTemplateInstantiation(remembers: boolean): Identifier {
    this.expect("?$");
    const outer = this.backReferences;
    this.backReferences = { names: [], functionParameters: [] };
    const identifier = this.readUnqualifiedSymbolName(true, false);
    identifier.templateParameters = this.readTemplateParameters();
    this.backReferences = outer;
    if (remembers) {
      if (identifier instanceof ConversionOperatorIdentifier || identifier instanceof StructorIdentifier) throw unread;
      this.rememberIdentifier(identifier);
    }
    return identifier;
  }

  private readTemplateParameters(): Node[] {
    const parameters: Node[] = [];
    while (!this.consume("@")) {
      if (this.isAtEnd) throw unread;
      if (this.consume("$S") || this.consume("$$V") || this.consume("$$$V") || this.consume("$$Z")) continue;
      parameters.push(this.readTemplateParameter());
    }
    return parameters;
  }

  private readTemplateParameter(): Node {
    const isDeduced = this.consume("$M");
    if (isDeduced) this.readType("Drop");
    if (this.consume("$$Y")) return this.readQualifiedTypeName();
    if (this.consume("$$B")) return this.readType("Drop");
    if (this.consume("$$C")) return this.readType("Mangle");
    if (this.startsWith("$E?")) {
      this.expect("$E");
      const reference = new TemplateParameterReference();
      reference.symbol = this.readSymbol();
      return reference;
    }
    const prefix = isDeduced ? "" : "$";
    const code = this.startsWith(prefix) ? (this.text[this.at + prefix.length] ?? "") : "";
    if (code !== "" && "1HIJFG0".includes(code)) {
      this.at += prefix.length + 1;
      if (code === "0") {
        const { value, isNegative } = this.readNumber();
        return new IntegerLiteral(value, isNegative);
      }
      const reference = new TemplateParameterReference();
      if ("1HIJ".includes(code)) {
        reference.isPointer = true;
        if (this.startsWith("?")) {
          reference.symbol = this.readSymbol();
          this.rememberIdentifier(reference.symbol.name.unqualified);
        }
      }
      const offsetCount = { "1": 0, "H": 1, "I": 2, "J": 3, "F": 2, "G": 3 }[code as "1" | "H" | "I" | "J" | "F" | "G"];
      for (let index = 0; index < offsetCount; index++) reference.thunkOffsets.push(this.readSigned());
      return reference;
    }
    return this.readType("Drop");
  }
}

function demangle(name: string, flags: number): string | undefined {
  try {
    const out = new Output();
    new Reader(name).readSymbol().output(out, flags);
    return out.text;
  } catch (error) {
    if (error === unread) return undefined;
    throw error;
  }
}

export const isMsvcName = (name: string): boolean => name.startsWith("?");

/** The qualified name and the parameters, close to what llvm-cxxfilt prints for an Itanium name; undefined for what is not read. */
export const demangleMsvcName = (name: string): string | undefined => demangle(name, nameAndParametersOnly);

/** As `llvm-undname` prints it. */
export const demangleMsvcDeclaration = (name: string): string | undefined => demangle(name, 0);
