// Nodes created by a factory get further properties from later passes, as in a compiler's binder and checker.
enum SyntaxKind { SourceFile, FunctionDeclaration, VariableDeclaration, Block, Identifier, NumericLiteral }
enum SymbolFlags { None = 0, Variable = 1 << 0, Function = 1 << 1, Redeclared = 1 << 2 }
enum FlowFlags { Start = 1 << 0, Assignment = 1 << 1, Container = 1 << 2 }
type Mutable<T extends object> = { -readonly [K in keyof T]: T[K] }
interface Sym { flags: SymbolFlags; escapedName: string; declarations: Declaration[] | undefined; valueDeclaration: Declaration | undefined; id: number; parent?: Sym; isReferenced?: boolean }
interface FlowNode { flags: FlowFlags; id: number; node: AstNode | undefined; antecedent: FlowNode | undefined } interface Ty { id: number; intrinsicName: string }
interface AstNode { readonly kind: SyntaxKind; readonly pos: number; readonly end: number; id: number; readonly parent: AstNode }
interface Declaration extends AstNode { symbol: Sym; localSymbol?: Sym }
interface LocalsContainer extends AstNode { locals?: Map<string, Sym>; nextContainer?: LocalsContainer } interface FlowContainer extends AstNode { flowNode?: FlowNode }
interface Identifier extends FlowContainer { readonly kind: SyntaxKind.Identifier; readonly text: string; resolvedSymbol?: Sym }
interface NumericLiteral extends AstNode { readonly kind: SyntaxKind.NumericLiteral; readonly value: number }
interface VariableDeclaration extends Declaration { readonly kind: SyntaxKind.VariableDeclaration; readonly name: Identifier; readonly initializer: AstNode | undefined; resolvedType?: Ty }
interface Block extends LocalsContainer { readonly kind: SyntaxKind.Block; readonly statements: AstNode[] }
interface FunctionDeclaration extends Declaration, LocalsContainer, FlowContainer { readonly kind: SyntaxKind.FunctionDeclaration; readonly name: Identifier; readonly body: Block; returnFlowNode?: FlowNode }
interface SourceFile extends LocalsContainer { readonly kind: SyntaxKind.SourceFile; readonly fileName: string; readonly statements: AstNode[]; symbolCount: number }
function AstNode(this: Mutable<AstNode>, kind: SyntaxKind, pos: number, end: number) { this.pos = pos; this.end = end; this.kind = kind; this.id = 0 }
function Sym(this: Sym, flags: SymbolFlags, escapedName: string) { this.flags = flags; this.escapedName = escapedName; this.declarations = undefined; this.valueDeclaration = undefined; this.id = 0 }
const objectAllocator = { getNodeConstructor: () => AstNode as any as new (kind: SyntaxKind, pos: number, end: number) => AstNode, getSymbolConstructor: () => Sym as any as new (flags: SymbolFlags, escapedName: string) => Sym }
let cursor = 0
function createNode<T extends AstNode>(kind: T["kind"], width: number) { const node = new (objectAllocator.getNodeConstructor())(kind, cursor, cursor + width) as Mutable<T>; cursor += width; return node }
function identifier(text: string): Identifier { const node = createNode<Identifier>(SyntaxKind.Identifier, text.length); node.text = text; return node }
function numeric(value: number): NumericLiteral { const node = createNode<NumericLiteral>(SyntaxKind.NumericLiteral, 1); node.value = value; return node }
function variable(text: string, initializer?: AstNode): VariableDeclaration { const node = createNode<VariableDeclaration>(SyntaxKind.VariableDeclaration, 4); node.name = identifier(text); node.initializer = initializer; return node }
function block(statements: AstNode[]): Block { const node = createNode<Block>(SyntaxKind.Block, 2); node.statements = statements; return node }
function func(text: string, statements: AstNode[]): FunctionDeclaration { const node = createNode<FunctionDeclaration>(SyntaxKind.FunctionDeclaration, 9); node.name = identifier(text); node.body = block(statements); return node }
function sourceFile(fileName: string, statements: AstNode[]): SourceFile { const node = createNode<SourceFile>(SyntaxKind.SourceFile, 0); node.fileName = fileName; node.statements = statements; return node }
function bindSourceFile(file: SourceFile) {
  let container: LocalsContainer = file, lastContainer: LocalsContainer = file, symbolCount = 0, flowCount = 0
  let currentFlow: FlowNode = { flags: FlowFlags.Start, id: ++flowCount, node: undefined, antecedent: undefined }
  function declareSymbol(node: Declaration, text: string, flags: SymbolFlags) {
    const locals = container.locals ||= new Map<string, Sym>()
    let symbol = locals.get(text)
    if (symbol) symbol.flags |= SymbolFlags.Redeclared
    else { symbolCount++; locals.set(text, symbol = new (objectAllocator.getSymbolConstructor())(SymbolFlags.None, text)) }
    symbol.flags |= flags; const declarations = symbol.declarations ||= []; declarations.push(node)
    if (!symbol.valueDeclaration) symbol.valueDeclaration = node
    if (container.kind === SyntaxKind.FunctionDeclaration) symbol.parent = (container as FunctionDeclaration).symbol
    node.symbol = symbol
  }
  function enter(next: LocalsContainer) { lastContainer.nextContainer = next; lastContainer = next; container = next }
  function bind(node: AstNode, parentNode: AstNode | undefined) {
    if (parentNode) (node as Mutable<AstNode>).parent = parentNode
    switch (node.kind) {
      case SyntaxKind.SourceFile: for (const s of (node as SourceFile).statements) bind(s, node); break
      case SyntaxKind.Identifier: (node as Identifier).flowNode = currentFlow; break
      case SyntaxKind.VariableDeclaration: {
        const v = node as VariableDeclaration; declareSymbol(v, v.name.text, SymbolFlags.Variable)
        if (v.initializer) { bind(v.initializer, v); currentFlow = { flags: FlowFlags.Assignment, id: ++flowCount, node: v, antecedent: currentFlow } }
        bind(v.name, v); break
      }
      case SyntaxKind.Block: {
        const b = node as Block, saved = container
        if (b.parent.kind !== SyntaxKind.FunctionDeclaration) enter(b)
        for (const s of b.statements) bind(s, b)
        container = saved; break
      }
      case SyntaxKind.FunctionDeclaration: {
        const f = node as FunctionDeclaration, saved = container, savedFlow = currentFlow
        declareSymbol(f, f.name.text, SymbolFlags.Function); bind(f.name, f); enter(f); f.flowNode = savedFlow
        currentFlow = { flags: FlowFlags.Start | FlowFlags.Container, id: ++flowCount, node: f, antecedent: undefined }
        bind(f.body, f)
        f.returnFlowNode = currentFlow; container = saved; currentFlow = savedFlow; break
      }
    }
  }
  bind(file, undefined); file.symbolCount = symbolCount
}
let nextNodeId = 1, nextSymbolId = 1
function getNodeId(node: AstNode): number { if (!node.id) node.id = nextNodeId++; return node.id } function getSymbolId(symbol: Sym): number { if (!symbol.id) symbol.id = nextSymbolId++; return symbol.id }
interface NodeLinks { flags: number; resolvedType?: Ty; resolvedSymbol?: Sym }
const nodeLinks: NodeLinks[] = []
function getNodeLinks(node: AstNode): NodeLinks { const id = getNodeId(node); return nodeLinks[id] || (nodeLinks[id] = { flags: 0 }) }
const numberType: Ty = { id: 1, intrinsicName: "number" }, anyType: Ty = { id: 2, intrinsicName: "any" }, functionType: Ty = { id: 3, intrinsicName: "function" }
function resolveName(start: AstNode, text: string): Sym | undefined {
  for (let at: AstNode | undefined = start; at; at = at.parent) {
    const locals = (at as LocalsContainer).locals, found = locals && locals.get(text); if (found) return found
  }
  return undefined
}
function getTypeOfNode(node: AstNode): Ty {
  switch (node.kind) {
    case SyntaxKind.NumericLiteral: return numberType
    case SyntaxKind.FunctionDeclaration: return functionType
    case SyntaxKind.VariableDeclaration: { const v = node as VariableDeclaration; return v.resolvedType ||= v.initializer ? getTypeOfNode(v.initializer) : anyType }
    case SyntaxKind.Identifier: {
      const id = node as Identifier, links = getNodeLinks(id), symbol = links.resolvedSymbol ||= resolveName(id, id.text)
      if (!symbol) return anyType; getSymbolId(symbol); symbol.isReferenced = true; id.resolvedSymbol = symbol; links.flags |= 1
      return links.resolvedType = symbol.valueDeclaration ? getTypeOfNode(symbol.valueDeclaration) : anyType
    }
    default: return anyType
  }
}
function each(node: AstNode, cb: (node: AstNode) => void) {
  cb(node)
  switch (node.kind) {
    case SyntaxKind.SourceFile: case SyntaxKind.Block: for (const s of (node as SourceFile | Block).statements) each(s, cb); break
    case SyntaxKind.VariableDeclaration: { const v = node as VariableDeclaration; each(v.name, cb); if (v.initializer) each(v.initializer, cb); break }
    case SyntaxKind.FunctionDeclaration: each((node as FunctionDeclaration).name, cb); each((node as FunctionDeclaration).body, cb); break
  }
}
function dump(file: SourceFile) { const lines: string[] = []; each(file, n => lines.push(SyntaxKind[n.kind] + "@" + n.pos + "-" + n.end + "#" + n.id + " " + Object.keys(n).join())); console.log(lines.join("\n")) }
function flowOf(node: FlowContainer): string { const ids: string[] = []; for (let f = node.flowNode; f; f = f.antecedent) ids.push(f.id + ":" + f.flags); return ids.join(">") }
function symbolText(s: Sym): string { return s.escapedName + " flags=" + s.flags + " id=" + s.id + " decls=" + (s.declarations ? s.declarations.length : 0) + " parent=" + (s.parent ? s.parent.escapedName : "-") + " " + s.isReferenced + " " + Object.keys(s).join() }
const useOfG = identifier("g"), useOfX = identifier("x"), useOfF = identifier("f"), useOfNothing = identifier("nothing")
const inner = block([variable("y", useOfX), variable("x", numeric(3))])
const f = func("f", [variable("x", useOfG), inner, variable("z"), variable("x")])
const file = sourceFile("a.ts", [variable("g", numeric(1)), f, variable("h", useOfF), variable("i", useOfNothing)])
dump(file)
console.log("parent" in f, f.parent, "symbol" in f, "locals" in file, file.locals, "symbolCount" in file, "flowNode" in useOfG, useOfG.flowNode, f.nextContainer)
bindSourceFile(file)
dump(file)
console.log(file.symbolCount, f.parent === file, inner.parent === f.body, useOfX.parent.parent === inner, file.parent, "parent" in file, f.symbol.escapedName, f.symbol.valueDeclaration === f)
console.log(file.nextContainer === f, f.nextContainer === inner, inner.nextContainer, flowOf(useOfG), flowOf(useOfX), flowOf(useOfF), flowOf(f), f.returnFlowNode ? f.returnFlowNode.id : -1)
for (const c of [file, f, inner, f.body] as LocalsContainer[]) console.log(SyntaxKind[c.kind], c.locals ? [...c.locals.values()].map(symbolText).join(" ; ") : "no locals")
console.log([useOfG, useOfX, useOfF, useOfNothing, file.statements[2], file.statements[3], f].map(n => getTypeOfNode(n).intrinsicName).join())
dump(file)
console.log(nodeLinks.length, 0 in nodeLinks, nodeLinks.map(l => Object.keys(l).join("+") + l.flags).join(), useOfX.resolvedSymbol === inner.locals?.get("x"), useOfNothing.resolvedSymbol, "resolvedSymbol" in useOfNothing)
for (const c of [file, f, inner] as LocalsContainer[]) console.log(c.locals ? [...c.locals.values()].map(symbolText).join(" ; ") : "no locals")
