import { Octokit } from "@octokit/rest";

const server = Bun.serve({
  port: 0,
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/repos/oven-sh/bun")
      return Response.json({ id: 1, full_name: "oven-sh/bun", stargazers_count: 3 });
    return Response.json({ message: "Not Found" }, { status: 404 });
  },
});
const octokit = new Octokit({
  baseUrl: `http://localhost:${server.port}`,
  log: { debug() {}, info() {}, warn() {}, error() {} },
});
const { data, status } = await octokit.rest.repos.get({ owner: "oven-sh", repo: "bun" });
console.log(status, data.full_name, data.stargazers_count);
try {
  await octokit.rest.repos.get({ owner: "oven-sh", repo: "missing" });
} catch (error) {
  console.log((error as { status: number }).status, (error as Error).name, (error as Error).message.split(" - ")[0]);
}
console.log(octokit.rest.issues.listForRepo.endpoint({ owner: "a", repo: "b", state: "open" }).url.replace(/:\d+/, ""));
server.stop(true);
