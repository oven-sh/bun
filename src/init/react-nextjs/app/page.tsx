import Link from "next/link";
import Image from "next/image";

async function getBunInfo() {
  return {
    version: Bun.version,
    revision: Bun.revision,
  };
}

export default async function Home() {
  const bunInfo = await getBunInfo();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 antialiased">
      <div className="w-full max-w-md">
        <div className="relative bg-card/80 backdrop-blur-xl text-card-foreground rounded-2xl border border-border/50 shadow-2xl overflow-hidden h-[550px] max-h-5/6 grid grid-rows-[auto_1fr_auto]">
          <div className="relative w-full overflow-hidden h-[250px]">
            <Image
              src="/header.webp"
              alt="Bun + Next.js"
              className="w-full h-full object-cover object-center"
              width={400}
              height={250}
              priority
            />
            <div className="absolute top-3 right-3 bg-zinc-800/75 text-white text-xs font-medium px-2.5 py-1.5 rounded-md shadow-2xl backdrop-blur-sm">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 bg-[#39FF14] rounded-full animate-pulse shadow-[0_0_8px_rgba(74,222,128,0.8)]"></div>
                <span>Bun {bunInfo.version}</span>
              </div>
              {bunInfo.revision && (
                <a
                  href={`https://github.com/oven-sh/bun/releases/tag/bun-v${bunInfo.version}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-mono mt-0.5 opacity-90 pl-[18px] hover:opacity-100 transition-opacity"
                >
                  {bunInfo.revision.slice(0, 8)}
                </a>
              )}
            </div>
          </div>

          <div className="px-4 overflow-hidden">
            <div className="flex flex-col items-center justify-center py-6 min-h-full">
              <div className="text-center space-y-3 w-full">
                <div>
                  <h1
                    className="text-2xl font-bold tracking-tight text-card-foreground leading-tight"
                    style={{ letterSpacing: "-0.02em" }}
                  >
                    Welcome to Next.js
                  </h1>
                  <p className="text-sm text-muted-foreground font-medium tracking-wide pb-2">
                    Powered by Bun {"\u2764\uFE0F"}
                  </p>
                </div>
                <div className="pt-2 border-t border-border/30">
                  <p className="text-sm text-muted-foreground/90 font-regular leading-relaxed max-w-sm mx-auto mt-2">
                    Edit{" "}
                    <code className="text-[11px] bg-zinc-200 dark:bg-zinc-800 px-1 py-0.5 rounded-xs mx-0.5">
                      app/page.tsx
                    </code>{" "}
                    to see HMR in action.
                    <br />
                    Visit{" "}
                    <Link
                      href="/stats"
                      className="text-foreground/80 hover:text-foreground underline underline-offset-2 transition-colors font-medium"
                    >
                      /stats
                    </Link>{" "}
                    for server-side info, or explore{" "}
                    <a
                      href="https://bun.com/docs/runtime/bun-apis"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground/80 hover:text-foreground underline underline-offset-2 transition-colors font-medium"
                    >
                      Bun&apos;s APIs
                    </a>
                    .<br />
                    <br />
                    Ready to deploy? Check out our{" "}
                    <a
                      href="https://bun.com/docs/guides/deployment/vercel"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground/80 hover:text-foreground underline underline-offset-2 transition-colors font-medium"
                    >
                      deployment guides
                    </a>
                    .
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="px-8 pb-6">
            <div className="pt-6">
              <Link
                href="/stats"
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
