import { ApolloServer } from "@apollo/server";

const typeDefs = `#graphql
  type Book { title: String author: String }
  type Query { books(author: String): [Book] }
`;
const books = [
  { title: "The Awakening", author: "Kate Chopin" },
  { title: "City of Glass", author: "Paul Auster" },
];
const server = new ApolloServer({
  typeDefs,
  resolvers: {
    Query: {
      books: (_: unknown, { author }: { author?: string }) => books.filter(book => !author || book.author === author),
    },
  },
});
await server.start();
for (const [query, variables] of [
  ["query ($author: String) { books(author: $author) { title } }", { author: "Paul Auster" }],
  ["{ books { pages } }", {}],
] as const) {
  const { body, http } = await server.executeOperation({ query, variables });
  console.log(
    http.status,
    body.kind,
    body.kind === "single" ? JSON.stringify(body.singleResult.data) : "",
    body.kind === "single" ? body.singleResult.errors?.map(error => error.extensions?.code).join() : "",
  );
}
await server.stop();
