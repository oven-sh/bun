import { createFileRoute, Link } from "@tanstack/react-router";
import headerImage from "../../assets/header.webp";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 antialiased">
      <div className="w-full max-w-md">
        <div className="relative bg-card/80 backdrop-blur-xl text-card-foreground rounded-2xl border border-border/50 shadow-2xl overflow-hidden h-[550px] max-h-5/6 grid grid-rows-[auto_1fr_auto]">
          <div className="relative w-full overflow-hidden h-[200px]">
            <img src={headerImage} alt="TanStack Logo" className="w-full h-full object-cover object-center" />
          </div>

          <div className="px-4 sm:px-8 overflow-y-auto">
            <div className="flex flex-col items-center justify-center py-6 min-h-full">
              <div className="text-center space-y-3 w-full">
                <div>
                  <h1
                    className="text-2xl sm:text-3xl font-semibold tracking-tight text-card-foreground leading-tight"
                    style={{ letterSpacing: "-0.02em" }}
                  >
                    Welcome to TanStack Start
                  </h1>
                  <p className="text-sm sm:text-md text-muted-foreground font-regular tracking-wide -mt pb-2">
                    Powered by Bun {"\u2764\uFE0F"}
                  </p>
                </div>
                <div className="pt-2 border-t border-border/30">
                  <p className="text-xs text-muted-foreground/80 font-regular leading-relaxed max-w-sm mx-auto mt-2 border-t border-border/3">
                    Edit{" "}
                    <code className="text-[11px] bg-zinc-800 px-1 py-0.5 rounded-xs mx-0.5">src/routes/index.tsx</code>{" "}
                    to see HMR in action.
                    <br />
                    Visit{" "}
                    <Link
                      to="/stats"
                      className="text-foreground/80 hover:text-foreground underline underline-offset-2 transition-colors"
                    >
                      /stats
                    </Link>{" "}
                    for server-side info, or explore{" "}
                    <a
                      href="https://bun.com/docs/runtime/bun-apis"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground/80 hover:text-foreground underline underline-offset-2 transition-colors"
                    >
                      Bun's APIs
                    </a>
                    .<br />
                    <br />
                    Ready to deploy? Check out the{" "}
                    <a
                      href="https://bun.com/guides/ecosystem/tanstack-start"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground/80 hover:text-foreground underline underline-offset-2 transition-colors"
                    >
                      TanStack guide
                    </a>
                    .
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="px-8 pb-10">
            <div className="pt-6 border-t border-border/30">
              <Link
                to="/stats"
                className="block w-full px-4 py-2 bg-foreground text-background rounded-lg font-medium hover:opacity-90 transition-opacity text-center text-sm"
              >
                View Server Stats →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
