// An object created as `Node` with `kind` equal to `Kind.Dot` cannot become a `Token<Kind.Dot>`.
const enum Kind { Unknown, Dot, Comma }
interface Node { readonly kind: Kind; readonly pos: number }
interface Token<K extends Kind> extends Node { readonly kind: K }
type DotToken = Token<Kind.Dot>
type Mutable<T extends object> = { -readonly [P in keyof T]: T[P] }
function TokenObject(this: Mutable<Node>, kind: Kind, pos: number) { this.kind = kind; this.pos = pos }
const TokenConstructor: new (kind: Kind, pos: number) => Node = TokenObject as any
interface Factory { createToken<K extends Kind>(kind: K): Token<K> }
function createBaseToken<T extends Node>(kind: T["kind"]) { return new TokenConstructor(kind, -1) as Mutable<T> }
function createToken<K extends Kind>(kind: K) { return createBaseToken<Token<K>>(kind) }
const factory: Factory = { createToken }
function attempt(label: string, f: () => DotToken) { try { const token = f(); console.log(label + ":", token.kind, token.pos) } catch (e) { console.log(label + ":", (e as Error).constructor.name) } }
attempt("through the interface, as", () => factory.createToken(Kind.Dot) as DotToken)
attempt("through the interface, annotated", () => { const token: DotToken = factory.createToken(Kind.Dot); return token })
export {};
