import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return <section><h2>the group's layout</h2>{children}</section>;
}
