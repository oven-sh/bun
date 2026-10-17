import type { APIRoute } from "astro";

export const ALL: APIRoute = ({ params, request }) => Response.json({ rest: params.rest, method: request.method }, { status: 404 });
