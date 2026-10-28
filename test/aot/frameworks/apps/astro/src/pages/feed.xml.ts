import type { APIRoute } from "astro";

export const GET: APIRoute = ({ site, url }) => new Response(`<?xml version="1.0"?><feed><site>${site ?? "none"}</site><path>${url.pathname}</path></feed>`, { headers: { "content-type": "application/xml" } });
