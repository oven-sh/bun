import { buildSchema, graphql, GraphQLInt, GraphQLObjectType, GraphQLSchema, GraphQLString, parse, print, validate } from "graphql";
import { timed } from "./lib_http.ts";

const schema = buildSchema(`type Person { id: Int! name: String! friends: [Person!]! } type Query { person(id: Int!): Person people: [Person!]! }`);
interface Person { id: number; name: string; friends: () => Person[] }
const people: Person[] = [{ id: 1, name: "ada", friends: () => [people[1]!] }, { id: 2, name: "grace", friends: () => [people[0]!] }];
const rootValue = { person: ({ id }: { id: number }) => people.find(p => p.id === id), people: () => people };
console.log(JSON.stringify(await graphql({ schema, rootValue, source: "{ person(id: 1) { name friends { name friends { id } } } }" })));
console.log(JSON.stringify(await graphql({ schema, rootValue, source: "query Q($id: Int!) { person(id: $id) { id } }", variableValues: { id: 2 } })));
console.log(JSON.stringify((await graphql({ schema, rootValue, source: "{ person { nope } }" })).errors?.map(error => error.message)));
console.log(print(parse("query{people{id,name}}")).replace(/\s+/g, " "), validate(schema, parse("{ people { id } }")).length);
const coded = new GraphQLSchema({ query: new GraphQLObjectType({ name: "Query", fields: { hello: { type: GraphQLString, args: { n: { type: GraphQLInt } }, resolve: (_source, { n }: { n?: number }) => "hi".repeat(n ?? 1) } } }) });
console.log(JSON.stringify(await graphql({ schema: coded, source: "{ hello(n: 2) }" })));
await timed("5,000 queries", async () => { for (let i = 0; i < 5000; i++) await graphql({ schema, rootValue, source: "{ people { id name friends { name } } }" }); });
console.log("DONE");
