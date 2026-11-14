import { sql } from "../database";
import type { Session } from "./types";

const sessions = new Map<string, Session>();

export async function loadSessions(): Promise<void> {
  const rows = await sql<Session[]>`SELECT token, customer_id AS "customerId", expires_at AS "expiresAt" FROM session`;
  for (const session of rows) sessions.set(session.token, session);
}

export function findSession(request: Request): Session | undefined {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return undefined;
  const session = sessions.get(authorization.slice("Bearer ".length));
  return session && session.expiresAt.getTime() > Date.now() ? session : undefined;
}
