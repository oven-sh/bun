// A generic function makes an object with Object.create(prototype), types it with a generic interface, and hands it to the
// caller's callback. The callback's parameter is an instantiation of that interface.
interface Endpoint<Name extends string> {
  readonly name: Name
}
interface Handlers<Endpoints extends Endpoint<string>, Handled extends string = never> {
  readonly '~Endpoints': Endpoints
  readonly names: string[]
  handle<Name extends Exclude<Endpoints['name'], Handled>>(name: Name, run: () => string): Handlers<Endpoints, Handled | Name>
}
const HandlersProto = {
  handle(this: Handlers<any, any>, name: string, run: () => string) {
    this.names.push(name + '=' + run())
    return this
  },
}
const makeHandlers = <Endpoints extends Endpoint<string>>(endpoints: readonly Endpoints[]): Handlers<Endpoints> => {
  const self = Object.create(HandlersProto)
  self.names = [String(endpoints.length)]
  return self
}
const group = <Endpoints extends Endpoint<string>, Result>(endpoints: readonly Endpoints[], build: (handlers: Handlers<Endpoints>) => Result): Result => build(makeHandlers(endpoints))
const text: Endpoint<'text'> = { name: 'text' }
const json: Endpoint<'json'> = { name: 'json' }
const built = group([text, json], handlers => handlers.handle('text', () => 'hello').handle('json', () => '{}'))
console.log(built.names.join())
