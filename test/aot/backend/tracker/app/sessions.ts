import type { BunRequest } from "bun";
import { sql } from "./database";
import type { Role, Session } from "./types";

interface SessionRow {
  token: string;
  csrfToken: string;
  flash: string | null;
  userId: number;
  login: string;
  name: string;
  role: Role;
}

async function sessionOfToken(token: string): Promise<Session | null> {
  const [row] = await sql<SessionRow[]>`
    SELECT s.token, s.csrf_token AS "csrfToken", s.flash, u.id AS "userId", u.login, u.name, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token} AND s.expires_at > now()`;
  if (!row) return null;
  if (row.flash !== null) await sql`UPDATE sessions SET flash = NULL WHERE token = ${token}`;
  return {
    token: row.token,
    csrfToken: row.csrfToken,
    flash: row.flash,
    user: { id: row.userId, login: row.login, name: row.name, role: row.role },
  };
}

/** The session that the browser's cookie names. */
export async function findSession(request: BunRequest): Promise<Session | null> {
  const token = request.cookies.get("sid");
  return token ? sessionOfToken(token) : null;
}

/** The session that a client of the API names: Authorization: Bearer <token>. */
export async function findBearerSession(request: Request): Promise<Session | null> {
  const authorization = request.headers.get("Authorization");
  return authorization?.startsWith("Bearer ") ? sessionOfToken(authorization.slice("Bearer ".length)) : null;
}

function randomToken(bytes: number): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("hex");
}

const thirtyDays = 30 * 24 * 60 * 60;

/** Signs a user in: a row, and a cookie that names it. */
export async function startSession(request: BunRequest, userId: number): Promise<void> {
  const token = randomToken(32);
  await sql`
    INSERT INTO sessions (token, user_id, csrf_token, expires_at)
    VALUES (${token}, ${userId}, ${randomToken(16)}, now() + ${thirtyDays} * interval '1 second')`;
  request.cookies.set("sid", token, { path: "/", httpOnly: true, sameSite: "lax", maxAge: thirtyDays });
}

export async function endSession(request: BunRequest, session: Session): Promise<void> {
  await sql`DELETE FROM sessions WHERE token = ${session.token}`;
  request.cookies.delete("sid", { path: "/" });
}
