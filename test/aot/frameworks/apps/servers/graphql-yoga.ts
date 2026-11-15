import { createSchema, createYoga } from "graphql-yoga";

const yoga = createYoga({
  logging: false,
  schema: createSchema({
    typeDefs: /* GraphQL */ `
      type Book {
        title: String!
        pages: Int
      }
      type Query {
        hello(name: String): String!
        books: [Book!]!
        fails: Int
      }
    `,
    resolvers: {
      Query: {
        hello: (_: unknown, { name }: { name?: string }) => `Hello ${name ?? "world"}`,
        books: () => [{ title: "A", pages: 1 }, { title: "B" }],
        fails: () => {
          throw new Error("hidden");
        },
      },
    },
  }),
});
const ask = async (query: string, variables?: object) => {
  const response = await yoga.fetch("http://yoga/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  console.log(response.status, await response.text());
};
await ask("query ($name: String) { hello(name: $name) books { title pages } }", { name: "Bun" });
await ask("{ nothing }");
await ask("{ fails }");
await ask('{ __type(name: "Book") { fields { name type { kind } } } }');
