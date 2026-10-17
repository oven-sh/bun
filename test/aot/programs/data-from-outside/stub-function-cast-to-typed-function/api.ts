export type Reply = { headers: Record<string, string>; url: string; code: number };
export type Ok<T> = { ok: true; data: T; status: number; reply: Reply };
export type Failed = { ok: false; reason: string; detail: string };
export type Result<T> = Ok<T> | Failed;
export type Routed<T> = Result<T> & { route: string; fromFar: boolean };

export const api = {
  async post<T>(path: string, body: unknown): Promise<Result<T>> {
    return { ok: false, reason: "offline", detail: path + " " + String(body) };
  },
  lookup(id: number): Reply {
    return { headers: {}, url: "/" + id, code: 200 };
  },
};

async function direct<T>(path: string): Promise<Result<T>> {
  return api.post<T>(path, null);
}
export const send = async <T>(path: string): Promise<Routed<T>> => ({ ...(await direct<T>(path)), route: "direct", fromFar: true });
export const sendUnrouted = async <T>(path: string): Promise<Result<T>> => {
  const result = await direct<T>(path);
  return result;
};
export function describeLookup(id: number): string {
  const reply = api.lookup(id);
  return reply.url + " " + reply.code;
}
