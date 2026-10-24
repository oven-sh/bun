// A plain object that is made with three properties, given two more, and handed to a typed handler that was stored as a value.
interface Endpoint<Params, Query> {
  readonly name: string;
  readonly decodeParams: (text: string) => Params;
  readonly decodeQuery: (text: string) => Query;
}
type RequestOf<E> = E extends Endpoint<infer Params, infer Query>
  ? { readonly params: Params; readonly query: Query; readonly request: string; readonly endpoint: string; readonly group: string }
  : never;
type Handler<E> = (request: RequestOf<E>) => string;

class Group<Endpoints extends Record<string, Endpoint<any, any>>> {
  readonly handlers = new Map<string, { readonly endpoint: Endpoint<any, any>; readonly handler: Handler<any> }>();
  constructor(readonly endpoints: Endpoints) {}
  handle<Name extends keyof Endpoints & string>(name: Name, handler: Handler<Endpoints[Name]>): this {
    this.handlers.set(name, { endpoint: this.endpoints[name]!, handler: handler as Handler<any> });
    return this;
  }
  dispatch(name: string, params: string, query: string): string {
    const { endpoint, handler } = this.handlers.get(name)!;
    const request: any = { request: "GET /" + name, endpoint: endpoint.name, group: "users" };
    request.params = endpoint.decodeParams(params);
    request.query = endpoint.decodeQuery(query);
    return handler(request);
  }
}

const posts: Endpoint<{ readonly id: number }, { readonly page: number }> = {
  name: "posts",
  decodeParams: text => ({ id: Number(text) }),
  decodeQuery: text => ({ page: Number(text) }),
};
const group = new Group({ posts }).handle(
  "posts",
  ({ params, query, request, endpoint, group }) => `${params.id} ${query.page} ${request} ${endpoint} ${group}`,
);
console.log(group.dispatch("posts", "42", "2"));
console.log(group.dispatch("posts", "7", "3"));
