const body = process.env.GITHUB_ISSUE_BODY;
const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN;

if (!body || !SENTRY_AUTH_TOKEN) {
  throw new Error("Missing environment variables");
}

const id = body.indexOf("<!-- sentry_id: ");
const endIdLine = body.indexOf(" -->", id + 1);
if (!(id > -1 && endIdLine > -1)) {
  throw new Error("Missing sentry_id");
}
const sentryId = body.slice(id + "<!-- sentry_id: ".length, endIdLine).trim();
if (!sentryId) {
  throw new Error("Missing sentry_id");
}

const response = await fetch(`https://sentry.io/api/0/organizations/4507155222364160/eventids/${sentryId}/`, {
  headers: {
    Authorization: `Bearer ${SENTRY_AUTH_TOKEN}`,
  },
});
if (!response.ok) {
  throw new Error(`Failed to fetch Sentry event: ${response.statusText}`);
}
const json = await response.json();
const groupId = json?.groupId;
if (!groupId) {
  throw new Error("Missing groupId");
}

const issueResponse = await fetch(`https://sentry.io/api/0/issues/${groupId}/`, {
  headers: {
    Authorization: `Bearer ${SENTRY_AUTH_TOKEN}`,
  },
});
if (!issueResponse.ok) {
  throw new Error(`Failed to fetch Sentry issue: ${issueResponse.statusText}`);
}
const { shortId, permalink } = await issueResponse.json();
if (!shortId || !permalink) {
  throw new Error("Missing shortId or permalink");
}

console.log(`Sentry ID: ${shortId}`);
console.log(`Sentry permalink: ${permalink}`);

await Bun.write("sentry-id.txt", shortId);
await Bun.write("sentry-link.txt", permalink);

export {};
