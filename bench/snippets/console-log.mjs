import { bench, run } from "../runner.mjs";

const json = {
  login: "wongmjane",
  id: 1332975,
  node_id: "MDQ6VXNlcjEzMzI5NzU=",
  avatar_url: "https://avatars.githubusercontent.com/u/1332975?v=4",
  gravatar_id: "",
  url: "https://api.github.com/users/wongmjane",
  html_url: "https://github.com/wongmjane",
  followers_url: "https://api.github.com/users/wongmjane/followers",
  following_url: "https://api.github.com/users/wongmjane/following{/other_user}",
  gists_url: "https://api.github.com/users/wongmjane/gists{/gist_id}",
  starred_url: "https://api.github.com/users/wongmjane/starred{/owner}{/repo}",
  subscriptions_url: "https://api.github.com/users/wongmjane/subscriptions",
  organizations_url: "https://api.github.com/users/wongmjane/orgs",
  repos_url: "https://api.github.com/users/wongmjane/repos",
  events_url: "https://api.github.com/users/wongmjane/events{/privacy}",
  received_events_url: "https://api.github.com/users/wongmjane/received_events",
  type: "User",
  site_admin: false,
  name: null,
  company: null,
  blog: "https://wongmjane.com",
  location: null,
  email: null,
  hireable: null,
  bio: null,
  twitter_username: "wongmjane",
  public_repos: 0,
  public_gists: 8,
  followers: 1197,
  following: 135,
  created_at: "2012-01-16T07:01:22Z",
  updated_at: "2022-11-23T16:12:24Z",
};

const inspect =
  "Bun" in globalThis ? Bun.inspect : "Deno" in globalThis ? Deno.inspect : (await import("util")).inspect;
bench("big json object", () => {
  console.error(json);
});

bench("inspect big json object", () => {
  console.error(inspect(json));
});

await run();
