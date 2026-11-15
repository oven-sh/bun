import {
  apiAdminStats,
  apiCreateComment,
  apiCreateIssue,
  apiIssue,
  apiIssueList,
  apiProjects,
  apiSearch,
  apiUpdateIssue,
  apiUser,
} from "./handlers/api";
import { createComment, createIssue, editIssuePage, login, loginPage, logout, newIssuePage, saveIssue } from "./handlers/forms";
import { adminPage, homePage, issueListPage, issuePage, notFoundPage, profilePage, searchPage, stylesheetFile } from "./handlers/pages";
import { problem } from "./http";

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 3000),
  reusePort: true,
  routes: {
    "/": { GET: homePage },
    "/assets/app.css": { GET: stylesheetFile },
    "/login": { GET: loginPage, POST: login },
    "/logout": { POST: logout },
    "/search": { GET: searchPage },
    "/admin": { GET: adminPage },
    "/u/:login": { GET: profilePage },
    "/p/:project/issues": { GET: issueListPage, POST: createIssue },
    "/p/:project/issues/new": { GET: newIssuePage },
    "/p/:project/issues/:number": { GET: issuePage, POST: saveIssue },
    "/p/:project/issues/:number/edit": { GET: editIssuePage },
    "/p/:project/issues/:number/comments": { POST: createComment },
    "/api/projects": { GET: apiProjects },
    "/api/projects/:project/issues": { GET: apiIssueList, POST: apiCreateIssue },
    "/api/projects/:project/issues/:number": { GET: apiIssue, PATCH: apiUpdateIssue },
    "/api/projects/:project/issues/:number/comments": { POST: apiCreateComment },
    "/api/search": { GET: apiSearch },
    "/api/users/:login": { GET: apiUser },
    "/api/admin/stats": { GET: apiAdminStats },
  },
  fetch(request) {
    return new URL(request.url).pathname.startsWith("/api/") ? problem(404, "not found") : notFoundPage(null);
  },
  error(error) {
    console.error(error);
    return new Response("Internal Server Error", { status: 500 });
  },
});

console.log("listening", server.port);
