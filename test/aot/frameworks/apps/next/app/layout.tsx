import type { ReactNode } from "react";

export const metadata = { title: "smoke", description: "a small application" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>the layout</header>
        {children}
      </body>
    </html>
  );
}
