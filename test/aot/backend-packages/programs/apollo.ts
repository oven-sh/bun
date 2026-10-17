import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";

const server = new ApolloServer<{ user: string }>({
  typeDefs: `type Query { hello(name: String!): String! whoami: String! broken: String }`,
  resolvers: { Query: { hello: (_parent: unknown, { name }: { name: string }) => "hello " + name, whoami: (_parent: unknown, _args: unknown, context: { user: string }) => context.user, broken: () => { throw new Error("broken"); } } },
  includeStacktraceInErrorResponses: false,
});
const { url } = await startStandaloneServer(server, { listen: { port: 0, host: "127.0.0.1" }, context: async ({ req }) => ({ user: String(req.headers["x-user"] ?? "nobody") }) });
const ask = async (query: string, variables?: Record<string, unknown>) => (await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-user": "ada" }, body: JSON.stringify({ query, variables }) })).text();
console.log((await ask("query($n: String!) { hello(name: $n) whoami }", { n: "world" })).trim());
console.log((await ask("{ broken }")).trim());
console.log((await ask("{ nope }")).trim());
const direct = await server.executeOperation({ query: "{ whoami }" }, { contextValue: { user: "direct" } });
console.log(JSON.stringify(direct.body));
await server.stop();
console.log("DONE");
