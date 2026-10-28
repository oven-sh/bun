import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("data", "routes/data.tsx"),
  route("person/:id", "routes/person.tsx"),
  route("api/hello", "routes/api.hello.ts"),
  route("old", "routes/old.ts"),
  route("form", "routes/form.tsx"),
  route("stream", "routes/stream.tsx"),
  route("throws", "routes/throws.tsx"),
  route("session", "routes/session.ts"),
  route("api/stream", "routes/api.stream.ts"),
  route("shell", "routes/shell.tsx", [route(":name", "routes/shell.child.tsx")]),
] satisfies RouteConfig;
