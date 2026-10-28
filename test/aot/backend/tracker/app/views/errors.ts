import type { Session } from "../types";
import { escape, layout } from "./layout";

export function errorPage(session: Session | null, title: string, message: string): string {
  return layout({ title, session, content: `<h1>${escape(title)}</h1>\n<p>${escape(message)}</p>` });
}
