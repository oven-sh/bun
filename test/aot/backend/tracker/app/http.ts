export function html(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...headers } });
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers });
}

export function problem(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

export function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}

/** 304 where the client holds what the tag names, otherwise nothing. */
export function notModified(request: Request, etag: string): Response | null {
  return request.headers.get("If-None-Match") === etag ? new Response(null, { status: 304, headers: { ETag: etag } }) : null;
}

export function searchParams(request: Request): URLSearchParams {
  return new URL(request.url).searchParams;
}
