import Head from "next/head";

export default function Layout({ children }) {
  return (
    <>
      <Head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta
          property="og:title"
          content="Bun is a fast all-in-one JavaScript runtime"
        />
        <title>Bun is a fast all-in-one JavaScript runtime</title>
        <meta
          property="og:description"
          content={`Bundle, transpile, install and run JavaScript & TypeScript
      projects – all in Bun. Bun is a new JavaScript runtime with
      a native bundler, transpiler, task runner and npm client built-in.`}
        />
        <meta name="og:locale" content="en_US" />
        <meta name="twitter:site" content="@jarredsumner" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta property="og:image" content="https://bun.sh/share.png" />
        <meta
          name="description"
          content={`Bundle, transpile, install and run JavaScript & TypeScript
      projects – all in Bun. Bun is a new JavaScript runtime with
      a native bundler, transpiler, task runner and npm client built-in.`}
        />
        <meta name="theme-color" content="#fbf0df" />
        <link rel="manifest" href="manifest.json" />
        <link
          rel="icon"
          type="image/png"
          sizes="256x256"
          href="/logo-square.png"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="32x32"
          href="/logo-square@32px.png"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="16x16"
          href="/logo-square@16px.png"
        />
      </Head>
      <body>
        <div id="header-wrap">
          <header>
            <a href="/" id="logo-link" aria-label="home">
              <img height="61px" src="/logo.svg" alt="Bun logo" id="logo" />
              <img
                height="31.65px"
                src="/Bun.png"
                srcSet="/Bun.png 1x, /Bun@2x.png 2x"
                alt="Bun"
                id="logo-text"
              />
            </a>

            <nav className="Navigation">
              <ul>
                <li>
                  <a
                    className="NavText"
                    href="https://github.com/oven-sh/bun#Reference"
                  >
                    Docs
                  </a>
                </li>
                <li>
                  <a className="NavText" href="https://bun.sh/discord">
                    Discord
                  </a>
                </li>
                <li>
                  <a className="NavText" href="https://github.com/oven-sh/bun">
                    GitHub
                  </a>
                </li>
              </ul>
            </nav>
          </header>
        </div>
        {children}
      </body>
    </>
  );
}
