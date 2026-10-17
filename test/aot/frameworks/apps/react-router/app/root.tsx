import type { ReactNode } from "react";
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError } from "react-router";

export const middleware = [
  async ({ request }: { request: Request }, next: () => Promise<Response>) => {
    const response = await next();
    response.headers.set("x-middleware-ran", new URL(request.url).pathname);
    return response;
  },
];

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head><meta charSet="utf-8" /><Meta /><Links /></head>
      <body><header>the layout</header>{children}<ScrollRestoration /><Scripts /></body>
    </html>
  );
}

export default function App() { return <Outlet />; }

export function ErrorBoundary() {
  const error = useRouteError();
  return <p>{isRouteErrorResponse(error) ? `${error.status} ${error.data}` : "an error"}</p>;
}
