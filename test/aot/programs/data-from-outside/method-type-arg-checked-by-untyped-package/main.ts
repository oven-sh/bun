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
