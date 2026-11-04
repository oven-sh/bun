// RUN: lower
// OPTIONS: builtin-modules

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

// GENERATED: Group handle dispatch decodeParams
// CHECK-LABEL: function {{*}}name="Group"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|object):
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_1]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_1]]}
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_2]]
// CHECK-NEXT: PropSet v4, v1 key="endpoints"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b1(| 0), notTaken b2(v4)
// CHECK-NEXT: b1(v9):
// CHECK-NEXT: Jump -> next b2(v9)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="handle"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=2 thisType={type=[[L_1]]} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: undefined|null|string, v2: undefined|null|[[f_3]]):
// CHECK-NEXT: v3 = PropGet v0 key="handlers"
// CHECK-NEXT: v4 = PropGet v3 key="set"
// CHECK-NEXT: v5 = PropGet v0 key="endpoints"
// CHECK-NEXT: v6 = ElemGet v5, v1
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v8 = Convert v2 declared={type=undefined|null|[[f_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v9 = NewObject -, v7, v8 layout=[[L_5]] fields=[0, 1]
// CHECK-NEXT: v10 = FinishObject v9
// CHECK-NEXT: v11 = Call v4, v3, v1, v10 calleeKey="set" calleeName="this.handlers.set"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Map<undefined|null|string, undefined|null|[[L_5]]> flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v13 = Convert v0 declared={type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="dispatch"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=3 thisType={type=[[L_1]]} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: undefined|null|string, v2: undefined|null|string, v3: undefined|null|string):
// CHECK-NEXT: v4 = PropGet v0 key="handlers"
// CHECK-NEXT: v5 = PropGet v4 key="get"
// CHECK-NEXT: v6 = Call v5, v4, v1 calleeKey="get" calleeName="this.handlers.get"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_5]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: v8 = TypeTest v7 testedType=undefined|null
// CHECK-NEXT: Branch v8 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v9):
// CHECK-NEXT: v10 = NewRuntimeError runtimeError=NotDestructurable name="endpoint"
// CHECK-NEXT: Throw v10
// CHECK-NEXT: b2(v11):
// CHECK-NEXT: v12 = PropGet v11 key="endpoint"
// CHECK-NEXT: v13 = PropGet v11 key="handler"
// CHECK-NEXT: v14 = String string="GET /"
// CHECK-NEXT: v15 = Add v14, v1
// CHECK-NEXT: v16 = PropGet v12 key="name"
// CHECK-NEXT: v17 = String string="users"
// CHECK-NEXT: v18 = NewObject -, v15, v16, v17 layout=[[L_6]] fields=[2, 0, 1]
// CHECK-NEXT: v19 = FinishObject v18
// CHECK-NEXT: v20 = PropGet v12 key="decodeParams"
// CHECK-NEXT: v21 = Call v20, v12, v2 calleeKey="decodeParams" calleeName="endpoint.decodeParams"
// CHECK-NEXT: PropSet v19, v21 key="params"
// CHECK-NEXT: v23 = PropGet v12 key="decodeQuery"
// CHECK-NEXT: v24 = Call v23, v12, v3 calleeKey="decodeQuery" calleeName="endpoint.decodeQuery"
// CHECK-NEXT: PropSet v19, v24 key="query"
// CHECK-NEXT: v26 = Call v13, -, v19 calleeName="handler"
// CHECK-NEXT: ReturnCall v26 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="decodeParams"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = Builtin builtin=Number
// CHECK-NEXT: v2 = Call v1, -, v0 calleeName="Number"
// CHECK-NEXT: v3 = Convert v2 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v4 = NewObject -, v3 layout=[[L_7]] fields=[0]
// CHECK-NEXT: v5 = FinishObject v4
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
