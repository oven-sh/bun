const BASE = "/api/v1";
const ROUTES = [
  { method: "GET", path: `${BASE}/users` },
  { method: "POST", path: `${BASE}/users` },
  { method: "GET", path: `${BASE}/users/:id` },
  { method: "DELETE", path: `${BASE}/users/:id`, admin: true },
];
const table = ROUTES.map((r) => `${r.method.padEnd(6)} ${r.path}${r.admin ? " (admin)" : ""}`);
console.log(table.join("\n"));
console.log(ROUTES.filter((r) => r.method === "GET").length, new Set(ROUTES.map((r) => r.path)).size);
