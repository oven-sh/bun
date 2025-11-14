// src/routes/__root.tsx
/// <reference types="vite/client" />
import { createRootRoute, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";

import appCss from "../../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Bun + TanStack Start Starter",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico" },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function NotFoundComponent() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 antialiased">
      <div className="w-full max-w-md">
        <div className="relative bg-card/80 backdrop-blur-xl text-card-foreground rounded-2xl border border-border/50 shadow-2xl overflow-hidden h-[400px] max-h-4/5 grid grid-rows-[auto_1fr_auto]">
          <div className="px-8 py-6">
            <div className="space-y-2 text-center py-2">
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">404</h1>
              <p className="text-lg text-muted-foreground font-medium -mt-2">Page Not Found</p>
            </div>
          </div>

          <div className="px-8 overflow-y-auto">
            <div className="flex flex-col items-center justify-center py-6 min-h-full">
              <p className="text-sm text-muted-foreground text-center">
                The page you're looking for doesn't exist or has been moved.
              </p>
            </div>
          </div>

          <div className="px-8 pb-10">
            <div className="pt-6 border-t border-border/30">
              <Link
                to="/"
                className="block w-full px-4 py-2 bg-foreground text-background rounded-lg font-medium hover:opacity-90 transition-opacity text-center text-sm"
              >
                ← Back to Home
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
