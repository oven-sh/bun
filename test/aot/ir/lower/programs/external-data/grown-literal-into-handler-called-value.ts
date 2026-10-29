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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_3]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_4]]
// CHECK-NEXT: PropSet v4, v1 key="endpoints"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Jump -> next b4(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="handle"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=2 thisType={type=[[L_3]] site=[[w_5]]} parameters=[{type=undefined|null|[[L_6]] site=[[w_7]]}, {type=undefined|null|[[f_8]] site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_3]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_3]], v1: undefined|null|[[L_6]], v2: undefined|null|[[f_8]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = PropGet v0 key="handlers"
// CHECK-NEXT: v4 = PropGet v3 key="set"
// CHECK-NEXT: v5 = PropGet v0 key="endpoints"
// CHECK-NEXT: v6 = ElemGet v5, v1
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_11]] site=[[w_12]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: v8 = Convert v2 declared={type=undefined|null|[[f_8]] site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v9 = NewObject -, v7, v8 layout=[[L_14]] fields=[0, 1]
// CHECK-NEXT: v10 = FinishObject v9
// CHECK-NEXT: v11 = Call v4, v3, v1, v10 calleeKey="set" calleeName="this.handlers.set"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Map<undefined|null|string, undefined|null|[[L_14]]> site=[[w_15]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v13 = Convert v0 declared={type=undefined|null|[[L_3]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="dispatch"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=3 thisType={type=[[L_3]] site=[[w_16]]} parameters=[{type=undefined|null|string site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_20]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_3]], v1: undefined|null|string, v2: undefined|null|string, v3: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = PropGet v0 key="handlers"
// CHECK-NEXT: v5 = PropGet v4 key="get"
// CHECK-NEXT: v6 = Call v5, v4, v1 calleeKey="get" calleeName="this.handlers.get"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_14]] site=[[w_21]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: v8 = TypeTest v7 testedType=undefined|null
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v10 = NewRuntimeError runtimeError=NotDestructurable name="endpoint"
// CHECK-NEXT: Throw v10
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: v12 = PropGet v11 key="endpoint"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[L_11]]} illTypedCause=Assertion
// CHECK-NEXT: v14 = PropGet v11 key="handler"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[f_8]]} illTypedCause=Assertion
// CHECK-NEXT: v16 = String string="GET /"
// CHECK-NEXT: v17 = Add v16, v1
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v19 = PropGet v13 key="name"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v21 = String string="users"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v23 = NewObject -, v18, v20, v22 layout=[[L_22]] fields=[2, 0, 1]
// CHECK-NEXT: v24 = FinishObject v23
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|number|string|symbol|bigint|[[L_23]] flags=[IsExpected]}
// CHECK-NEXT: v26 = PropGet v13 key="decodeParams"
// CHECK-NEXT: v27 = Call v26, v13, v2 calleeKey="decodeParams" calleeName="endpoint.decodeParams"
// CHECK-NEXT: PropSet v25, v27 key="params"
// CHECK-NEXT: v29 = Convert v25 declared={type=undefined|null|number|string|symbol|bigint|[[L_24]] flags=[IsExpected]}
// CHECK-NEXT: v30 = PropGet v13 key="decodeQuery"
// CHECK-NEXT: v31 = Call v30, v13, v3 calleeKey="decodeQuery" calleeName="endpoint.decodeQuery"
// CHECK-NEXT: PropSet v29, v31 key="query"
// CHECK-NEXT: v33 = Convert v29 declared={type=undefined|null|[[L_25]] flags=[IsExpected]}
// CHECK-NEXT: v34 = Call v15, -, v33 calleeName="handler"
// CHECK-NEXT: ReturnCall v34 casts=[{declared={type=undefined|null|string site=[[w_26]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_20]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="decodeParams"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_27]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_28]] site=[[w_29]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_30]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Number
// CHECK-NEXT: v2 = Call v1, -, v0 calleeName="Number"
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_31]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v4 = NewObject -, v3 layout=[[L_28]] fields=[0]
// CHECK-NEXT: v5 = FinishObject v4
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_28]] site=[[w_29]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
