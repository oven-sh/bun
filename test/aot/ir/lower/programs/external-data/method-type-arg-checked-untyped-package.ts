// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// A generic async method keeps its resolver in a map; another method settles it later with what an untyped package's parse() returns. The caller, a method of the same class, awaits it with an explicit type argument that is a record type. Nothing in the program creates an object of that type; its only namesake is the literal handed to the untyped package. The answer matches the type and must be accepted, as in plain Bun.
import { any, object, type Schema } from './schema.js'
type Message = { id?: number; method?: string; result?: unknown }
type Pending<T> = { resolve: (result: T) => void; reject: (error: unknown) => void; schema?: Schema }

class Wire {
  private readonly pending = new Map<string, Pending<unknown>>()
  private next = 0

  arrive(line: string): void {
    const message = JSON.parse(line)
    const waiting = this.pending.get(message.request_id)
    if (!waiting) return
    this.pending.delete(message.request_id)
    if (message.subtype === 'error') return waiting.reject(new Error(message.error))
    const result = message.response ?? {}
    try {
      waiting.resolve(waiting.schema ? waiting.schema.parse(result) : {})
    } catch (error) {
      waiting.reject(error)
    }
  }

  private async send<Response>(request: { kind: string; body: unknown }, schema: Schema, { id = 'r' + this.next++ }: { id?: string } = {}): Promise<Response> {
    if (request.kind === '') throw new Error('no kind')
    Promise.resolve().then(() => this.arrive('{"request_id": "' + id + '", "subtype": "success", "response": {"reply": {"id": 7, "result": ' + JSON.stringify(request.body) + '}}}'))
    try {
      return await new Promise<Response>((resolve, reject) => {
        this.pending.set(id, { resolve: result => resolve(result as Response), reject, schema })
      })
    } finally {
      this.pending.delete(id)
    }
  }

  async ask(name: string, message: Message): Promise<Message> {
    const response = await this.send<{ reply: Message }>({ kind: 'ask', body: { name, message } }, object({ reply: any() as Schema<Message> }))
    return response.reply
  }
}
console.log(JSON.stringify(await new Wire().ask('n', { id: 1, method: 'm' })))

// FILE: schema.d.ts
export type Schema<T = unknown> = { parse(given: unknown): T }
export function object(shape: Record<string, Schema>): Schema
export function any(): Schema<any>

// FILE: schema.js
export function object(shape) {
  return {
    parse(given) {
      const out = {}
      for (const key of Object.keys(shape)) if (key in given) out[key] = given[key]
      return out
    },
  }
}
export function any() {
  return { parse: given => given }
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: Wire ask resolve
// CHECK-LABEL: function {{*}}name="Wire"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_2]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="ask"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=2 thisType={type=[[L_1]] site=[[w_3]]} parameters=[{type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|number|string|symbol|bigint|[[L_5]] flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise<undefined|null|number|string|symbol|bigint|[[L_5]]> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: undefined|null|string, v2: undefined|null|number|string|symbol|bigint|[[L_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = PropGet v0 key="send"
// CHECK-NEXT: v4 = String string="ask"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v6 = Convert v1 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v7 = Convert v2 declared={type=undefined|null|number|string|symbol|bigint|[[L_5]] flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v8 = NewObject -, v6 layout=[[L_6]] fields=[1]
// CHECK-NEXT: PropDefine v8, v7 key="message"
// CHECK-NEXT: v10 = FinishObject v8
// CHECK-NEXT: v11 = NewObject -, v5, v10 layout=[[L_7]] fields=[1, 0]
// CHECK-NEXT: v12 = FinishObject v11
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="object"
// CHECK-NEXT: v15 = NewObject layout=[[L_9]]
// CHECK-NEXT: v16 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v17 = CheckInitialized v16 name="any"
// CHECK-NEXT: v18 = Call v17 calleeName="any"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|[[L_11]] flags=[IsExpected]}
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|number|string|symbol|bigint|[[L_11]]|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v15, v20 key="reply"
// CHECK-NEXT: v22 = FinishObject v15
// CHECK-NEXT: v23 = Call v14, -, v22 calleeName="object"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|[[L_11]] flags=[IsExpected]}
// CHECK-NEXT: v25 = Call v3, v0, v12, v24 calleeKey="send" calleeName="this.send"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|Promise<undefined|null|[[L_9]]> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v27 = Await v26, v1, v2
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|[[L_9]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v29 = PropGet v28 key="reply"
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|number|string|symbol|bigint|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|number|string|symbol|bigint|object flags=[IsExpected]}
// CHECK-NEXT: Return v31
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="resolve"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 captures=[{type=undefined|null|[[f_13]] flags=[IsExpected]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_13]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_15]] site=[[w_16]]} illTypedCause=FromLooseType
// CHECK-NEXT: v3 = Call v0, -, v2 calleeName="resolve"
// CHECK-NEXT: ReturnCall v3
// CHECK-NEXT: }
