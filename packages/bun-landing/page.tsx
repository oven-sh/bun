import * as shiki from "shiki";

globalThis._highlighter ||= await shiki.getHighlighter({
  theme: "dracula",
});

const highlighter = globalThis._highlighter as shiki.Highlighter;

const CodeBlock = ({ children, lang = "js" }) => {
  const html = highlighter.codeToHtml(children.trim(), { lang });
  return (
    <div className="CodeBlock" dangerouslySetInnerHTML={{ __html: html }} />
  );
};

const Command = ({ children, href, Tag = href ? "a" : "span" }) => (
  <Tag target="_blank" href={href} className="Tag Tag--Command">
    {children}
  </Tag>
);
const WebAPI = ({ children, href, Tag = href ? "a" : "span" }) => (
  <Tag target="_blank" href={href} className="Tag Tag--WebAPI">
    {children}
  </Tag>
);
const NodeJS = ({ children, href, Tag = href ? "a" : "span" }) => (
  <Tag target="_blank" href={href} className="Tag Tag--NodeJS">
    {children}
  </Tag>
);
const TypeScript = ({ children, href, Tag = href ? "a" : "span" }) => (
  <Tag target="_blank" href={href} className="Tag Tag--TypeScript">
    {children}
  </Tag>
);
const React = ({ children, href, Tag = href ? "a" : "span" }) => (
  <Tag target="_blank" className="Tag Tag--React">
    {children}
  </Tag>
);

const Bun = ({ children, href, Tag = href ? "a" : "span" }) => (
  <Tag target="_blank" href={href} className="Tag Tag--Bun">
    {children}
  </Tag>
);

const Zig = ({}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    height="1.2rem"
    className="Zig"
    viewBox="0 0 400 140"
  >
    <g fill="#F7A41D">
      <g>
        <polygon points="46,22 28,44 19,30" />
        <polygon
          points="46,22 33,33 28,44 22,44 22,95 31,95 20,100 12,117 0,117 0,22"
          shape-rendering="crispEdges"
        />
        <polygon points="31,95 12,117 4,106" />
      </g>
      <g>
        <polygon points="56,22 62,36 37,44" />
        <polygon
          points="56,22 111,22 111,44 37,44 56,32"
          shape-rendering="crispEdges"
        />
        <polygon points="116,95 97,117 90,104" />
        <polygon
          points="116,95 100,104 97,117 42,117 42,95"
          shape-rendering="crispEdges"
        />
        <polygon points="150,0 52,117 3,140 101,22" />
      </g>
      <g>
        <polygon points="141,22 140,40 122,45" />
        <polygon
          points="153,22 153,117 106,117 120,105 125,95 131,95 131,45 122,45 132,36 141,22"
          shape-rendering="crispEdges"
        />
        <polygon points="125,95 130,110 106,117" />
      </g>
    </g>
    <g fill="#121212">
      <g>
        <polygon
          points="260,22 260,37 229,40 177,40 177,22"
          shape-rendering="crispEdges"
        />
        <polygon points="260,37 207,99 207,103 176,103 229,40 229,37" />
        <polygon
          points="261,99 261,117 176,117 176,103 206,99"
          shape-rendering="crispEdges"
        />
      </g>
      <rect
        x="272"
        y="22"
        shape-rendering="crispEdges"
        width="22"
        height="95"
      />
      <g>
        <polygon
          points="394,67 394,106 376,106 376,81 360,70 346,67"
          shape-rendering="crispEdges"
        />
        <polygon points="360,68 376,81 346,67" />
        <path
          d="M394,106c-10.2,7.3-24,12-37.7,12c-29,0-51.1-20.8-51.1-48.3c0-27.3,22.5-48.1,52-48.1
			c14.3,0,29.2,5.5,38.9,14l-13,15c-7.1-6.3-16.8-10-25.9-10c-17,0-30.2,12.9-30.2,29.5c0,16.8,13.3,29.6,30.3,29.6
			c5.7,0,12.8-2.3,19-5.5L394,106z"
        />
      </g>
    </g>
  </svg>
);

const InstallBox = ({ desktop = false }) => (
  <div
    className={
      "InstallBox " + (desktop ? "InstallBox--desktop" : "InstallBox--mobile")
    }
    id="install"
  >
    <div id="install-label">
      <div className="unselectable" id="install-label-heading">
        Install Bun CLI v0.1.0 (beta)
      </div>
      <div className="unselectable" id="install-label-subtitle">
        macOS x64 &amp; Silicon, Linux x64, Windows Subsystem for Linux
      </div>
    </div>
    <div id="code-box">
      <div id="curl">curl https://bun.sh/install | bash</div>
      <div className="unselectable" id="code-box-copy">
        copy
      </div>
    </div>
    <a
      className="unselectable"
      id="view-source-link"
      target="_blank"
      href="https://bun.sh/install"
    >
      Show script source
    </a>
  </div>
);

export default () => (
  <html>
    <head>
      <link rel="stylesheet" href="/index.css" />
      <script type="module" src="/index.js"></script>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
    </head>

    <body>
      <div id="header-wrap">
        <header>
          <a href="/" id="logo-link">
            <img src="/public/logo@2x.png" alt="Bun" id="logo" />
            <img src="/public/Bun@2x.png" alt="Bun" id="logo-text" />
          </a>

          <nav className="Navigation">
            <li>
              <a className="NavText" href="/docs">
                Docs
              </a>
            </li>
            <li>
              <a className="NavText" href="/discord">
                Discord
              </a>
            </li>
            <li>
              <a className="NavText" href="/github">
                GitHub
              </a>
            </li>
          </nav>
          <div id="HeaderInstallButton">Install</div>
        </header>
      </div>
      <div id="pitch">
        <main>
          <div id="pitch-content">
            <h1 className="tagline">
              Bun is a fast all-in-one JavaScript runtime
            </h1>
            <p className="subtitle">
              Bundle, transpile, install and run JavaScript &amp; TypeScript
              projects &mdash; all in Bun. Bun is a new JavaScript runtime with
              a native bundler, transpiler, task runner and npm client built-in.
            </p>

            <InstallBox desktop />
          </div>
          <div className="Graphs">
            <div className="Tabs">
              <div className="Tab Tab--active">Bun.serve</div>
              <div className="Tab">bun:sqlite</div>
              <div className="Tab">bun:ffi</div>
            </div>
            <div className="ActiveTab">
              <div className="BarGraph BarGraph--horizontal BarGraph--dark">
                <div className="BarGraph-heading">HTTP requests per second</div>
                <div className="BarGraph-subheading">
                  Serving a 47 KB file * Bigger is better
                </div>

                <div style={{ "--count": 3 }} className="BarGraphList">
                  <div
                    className="BarGraphItem BarGraphItem--bun"
                    style={{ "--amount": 41829 }}
                  >
                    <div
                      style={{ "--amount": 41829 }}
                      title="41829 requests per second"
                      className="BarGraphBar"
                    >
                      <div
                        style={{ "--amount": 41829 }}
                        className="BarGraphBar-label"
                      >
                        41,829
                      </div>
                    </div>
                  </div>

                  <div
                    style={{ "--amount": 2584 }}
                    className="BarGraphItem BarGraphItem--node"
                  >
                    <div
                      title="1,843 requests per second"
                      style={{ "--amount": 2584 }}
                      className="BarGraphBar"
                    >
                      <div
                        style={{ "--amount": 2584 }}
                        className="BarGraphBar-label"
                      >
                        2,584
                      </div>
                    </div>
                  </div>

                  <div
                    className="BarGraphItem BarGraphItem--deno"
                    style={{ "--amount": 365 }}
                  >
                    <div
                      style={{ "--amount": 365 }}
                      title="365 requests per second"
                      className="BarGraphBar"
                    >
                      <div
                        style={{ "--amount": 365 }}
                        className="BarGraphBar-label"
                      >
                        365
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ "--count": 3 }} className="BarGraphKey">
                  <div className="BarGraphKeyItem">
                    <div className="BarGraphKeyItem-label">bun.js</div>
                    <div className="BarGraphKeyItem-value">v0.0.78</div>
                  </div>

                  <div className="BarGraphKeyItem">
                    <div className="BarGraphKeyItem-label">node.js</div>
                    <div className="BarGraphKeyItem-value">v17.7.1</div>
                  </div>

                  <div className="BarGraphKeyItem">
                    <div className="BarGraphKeyItem-label">deno</div>
                    <div className="BarGraphKeyItem-value">v1.20.5</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <InstallBox desktop={false} />
        </main>
      </div>
      <section id="explain-section">
        <div id="explain">
          <h1>🐚 All the tools</h1>
          <ul>
            <li title="npm takes 160ms to run a script that does nothing">
              <Command>bun run</Command> start &nbsp;
              <code className="mono">package.json "scripts"</code> 30x faster
              than <code className="mono">npm run</code>
            </li>

            <li title="JavaScript package managers are not using the fastest system calls">
              <Command>bun install</Command> installs npm packages up to 100x
              faster than npm, yarn or pnpm (when disk cached)
            </li>
            <li>
              <Command>bun dev</Command> bun's frontend dev server starts in
              about 15ms
            </li>

            <li>
              <Command>bun bun</Command> bundle node_modules into a single file
              (~1 million LOC/s input)
            </li>

            <li>
              <Command>bun wiptest</Command> you've never seen a JavaScript test
              runner this fast (or incomplete)
            </li>
          </ul>

          <h1>🔋 Batteries included</h1>
          <ul>
            <li>
              Web APIs like{" "}
              <WebAPI href="https://developer.mozilla.org/en-US/docs/Web/API/fetch">
                fetch
              </WebAPI>
              ,{" "}
              <WebAPI href="https://developer.mozilla.org/en-US/docs/Web/API/WebSocket">
                WebSocket
              </WebAPI>
              , and{" "}
              <WebAPI href="https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream">
                ReadableStream
              </WebAPI>{" "}
              are builtin
            </li>
            <li>
              <NodeJS>node_modules</NodeJS> bun implements Node.js' module
              resolution algorithm, so you can use npm packages in bun.js. ESM
              and CommonJS are supported, but Bun internally uses ESM.
            </li>
            <li>
              <React>JSX</React> <TypeScript>TypeScript</TypeScript> in bun.js,
              every file is transpiled. TypeScript &amp; JSX just work.
            </li>
            <li>
              <TypeScript>tsconfig.json</TypeScript> bun supports{" "}
              <code className="">"paths"</code>, <code>"jsxImportSource"</code>
              and more from tsconfig.json
            </li>
            <li>
              <Bun>Bun.Transpiler</Bun> bun's JSX &amp; TypeScript transpiler is
              available as an API in Bun.js
            </li>
            <li>
              <Bun>Bun.write</Bun> use the fastest system calls available to
              write, copy, pipe, send and clone files.
            </li>
            <li>
              <Bun>.env</Bun> bun.js automatically loads environment variables
              from .env files. No more{" "}
              <code class="mono">require("dotenv").load()</code>
            </li>
            <li>
              <Bun>bun:sqlite</Bun> fast SQLite3 client built-in
            </li>
            <li>
              <NodeJS href="https://github.com/Jarred-Sumner/bun/issues/158">
                Node-API
              </NodeJS>{" "}
              bun.js implements most of Node-API (NAPI). Many Node.js native
              modules just work.
            </li>
            <li>
              <Bun>bun:ffi</Bun> call native code from JavaScript with bun's
              low-overhead foreign function interface
            </li>
            <li>
              <NodeJS>node:fs</NodeJS> <NodeJS>node:path</NodeJS> bun.js
              natively supports a growing list of Node.js core modules along
              with globals like Buffer and process.
            </li>
          </ul>

          <h1>Getting started</h1>

          <p>
            To install bun, run this{" "}
            <a target="_blank" href="https://bun.sh/install">
              install script
            </a>{" "}
            in your terminal. It downloads Bun from GitHub.
          </p>

          <CodeBlock lang="shell">{`
curl https://bun.sh/install | bash
          `}</CodeBlock>

          <p>
            {" "}
            Bun's HTTP server is built on web standards like
            <a
              className="Identifier"
              href="https://developer.mozilla.org/en-US/docs/Web/API/Request"
            >
              Request
            </a>
            and{" "}
            <a
              className="Identifier"
              href="https://developer.mozilla.org/en-US/docs/Web/API/Response"
            >
              Response
            </a>
          </p>

          <CodeBlock lang="js">{`
// http.js
export default {
  port: 3000,
  fetch(request) {
    return new Response("Welcome to Bun!");
  },
};
          `}</CodeBlock>

          <p>Run it with bun:</p>

          <CodeBlock lang="shell">{`bun run http.js`}</CodeBlock>

          <p>
            Then open{" "}
            <a target="_blank" href="http://localhost:3000">
              http://localhost:3000
            </a>{" "}
            in your browser
            <br />
            <br />
            See{" "}
            <a href="https://github.com/Jarred-Sumner/bun/tree/main/examples">
              more examples
            </a>{" "}
            and check out <a href="/docs">the docs</a>. If you have any
            questions or want help, join{" "}
            <a href="https://bun.sh/discord">Bun's Discord</a>
          </p>

          <h1>How does Bun work?</h1>

          <p>
            Bun.js uses the{" "}
            <a href="https://github.com/WebKit/WebKit/tree/main/Source/JavaScriptCore">
              JavaScriptCore
            </a>{" "}
            engine, which tends{" "}
            <a
              target="blank"
              href="https://twitter.com/jarredsumner/status/1499225725492076544"
            >
              to start
            </a>{" "}
            and perform a little faster than more traditional choices like V8.
            Bun is written in{" "}
            <a href="https://ziglang.org/">
              <Zig></Zig>
            </a>
            , a low-level programming language with manual memory management.
            <br />
            <br />
            Most of Bun is written from scratch including the JSX/TypeScript
            transpiler, npm client, bundler, SQLite client, HTTP client,
            WebSocket client and more.
          </p>

          <h1>Why is Bun fast?</h1>
          <p>
            An enourmous amount of time spent profiling, benchmarking and
            optimizing things. The answer is different for every part of Bun,
            but one general theme:{" "}
            <a href="https://ziglang.org/">
              <Zig></Zig>
            </a>{" "}
            's low-level control over memory and lack of hidden control flow
            makes it much simpler to write fast software.{" "}
            <a href="https://github.com/sponsors/ziglang">
              Sponsor the Zig Software Foundation
            </a>
          </p>

          <h1>What is the license?</h1>
          <p>
            MIT License, excluding dependencies which have various licenses.
          </p>

          <h1>How do I see the source code?</h1>
          <p>
            Bun is on <a href="https://github.com/Jarred-Sumner/bun">GitHub</a>
          </p>
        </div>
      </section>

      <section id="explain-section">
        <div id="explain"></div>
      </section>
    </body>
  </html>
);
