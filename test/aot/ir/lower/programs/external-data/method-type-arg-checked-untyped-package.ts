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
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_2]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="ask"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=2 syntax=[HasWrittenAwait] thisType={type=[[L_1]]} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|number|string|symbol|bigint|[[L_3]] flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise<undefined|null|number|string|symbol|bigint|[[L_3]]> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: undefined|null|string, v2: undefined|null|number|string|symbol|bigint|[[L_3]]):
// CHECK-NEXT: v3 = PropGet v0 key="send"
// CHECK-NEXT: v4 = String string="ask"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v6 = NewObject -, v1, v2 layout=[[L_4]] fields=[1, 0]
// CHECK-NEXT: v7 = FinishObject v6
// CHECK-NEXT: v8 = NewObject -, v5, v7 layout=[[L_5]] fields=[1, 0]
// CHECK-NEXT: v9 = FinishObject v8
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="object"
// CHECK-NEXT: v12 = NewObject layout=[[L_7]]
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="any"
// CHECK-NEXT: v15 = Call v14 calleeName="any"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v12, v16 key="reply"
// CHECK-NEXT: v18 = FinishObject v12
// CHECK-NEXT: v19 = Call v11, -, v18 calleeName="object"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: v21 = Call v3, v0, v9, v20 calleeKey="send" calleeName="this.send"
// CHECK-NEXT: v22 = Await v21, v1, v2
// CHECK-NEXT: v23 = PropGet v22 key="reply"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|number|string|symbol|bigint|object flags=[IsExpected]}
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="resolve"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 captures=[{type=undefined|null|[[f_10]] flags=[IsExpected] variableName="resolve"}] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_10]], v1: anything):
// CHECK-NEXT: v2 = Call v0, -, v1 calleeName="resolve"
// CHECK-NEXT: ReturnCall v2
// CHECK-NEXT: }
