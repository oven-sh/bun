import { readFileSync } from "fs";
import * as shiki from "shiki";

const DOCS = "https://github.com/Jarred-Sumner/bun#Reference";

// because we don't want to wait for it to reload everytime this page reloads
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

const fmt = new Intl.NumberFormat();

const Label = ({ children, replace }) => {
  if (replace) {
    return (
      <div className="Label">
        <div className="Label-replace">{replace}</div>
        <div className="Label-text">{children}</div>
      </div>
    );
  }
  return <div className="Label">{children}</div>;
};

const BarGraphItem = ({ type, amount = 0, label, max = 0 }) => (
  <div
    className={`BarGraphItem BarGraphItem--${type}`}
    style={{ "--amount": amount, "--max": max }}
  >
    <div
      style={{ "--amount": amount, "--max": max }}
      title={`${amount} ${label}`}
      className="BarGraphBar"
    >
      <div
        style={{ "--amount": amount, "--max": max }}
        className="BarGraphBar-label"
      >
        {fmt.format(amount)}
      </div>
    </div>
  </div>
);

const BarGraphLabel = ({ name, version, source }) => (
  <a href={source} target="_blank" className="BarGraphKeyItem">
    <div className="BarGraphKeyItem-label">{name}</div>
    <div className="BarGraphKeyItem-value">{version}</div>
    <div className="BarGraphKeyItem-viewSource">View source</div>
  </a>
);

const PerformanceClaim = ({ href, children }) => (
  <a href={href} target="_blank" className="PerformanceClaim">
    {children}
  </a>
);

const Zig = () => (
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

const Group = ({ children, ...props }) => (
  <div {...props} className="Group">
    {children}
  </div>
);

export default ({ inlineCSS }) => (
  <html>
    <head>
      <meta charSet="UTF-8" />

      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta
        property="og:title"
        content="Bun is a fast all-in-one JavaScript runtime"
      />
      <meta
        property="og:description"
        content={`Bundle, transpile, install and run JavaScript & TypeScript
        projects – all in Bun. Bun is a new JavaScript runtime with
        a native bundler, transpiler, task runner and npm client built-in.`}
      />
      <title>Bun is a fast all-in-one JavaScript runtime</title>

      {inlineCSS ? (
        <style
          dangerouslySetInnerHTML={{
            __html: readFileSync(import.meta.dir + "/index.css", "utf8"),
          }}
        ></style>
      ) : (
        <link rel="stylesheet" href="/index.css" />
      )}
    </head>

    <body>
      <div id="header-wrap">
        <header>
          <a href="/" id="logo-link">
            <img height="61px" src={`/logo@2x.png`} alt="Bun" id="logo" />
            <img
              height="31.65px"
              src={`/Bun@2x.png`}
              alt="Bun"
              id="logo-text"
            />
          </a>

          <nav className="Navigation">
            <li>
              <a className="NavText" href={DOCS}>
                Docs
              </a>
            </li>
            <li>
              <a className="NavText" href="https://bun.sh/discord">
                Discord
              </a>
            </li>
            <li>
              <a
                className="NavText"
                href="https://github.com/Jarred-Sumner/bun"
              >
                GitHub
              </a>
            </li>
          </nav>
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

          <div className="Graphs Graphs--active-react">
            <div className="Tabs">
              <div data-tab="react" className="Tab">
                Bun.serve
              </div>
              <div data-tab="sqlite" className="Tab">
                bun:sqlite
              </div>
              <div data-tab="ffi" className="Tab">
                bun:ffi
              </div>
            </div>
            <div id="active-tab" className="ActiveTab">
              <div className="BarGraph BarGraph--react BarGraph--horizontal BarGraph--dark">
                <div className="BarGraph-heading">
                  Server-side rendering React
                </div>
                <div title="oha -z 5s" className="BarGraph-subheading">
                  HTTP requests per second (Linux AMD64)
                </div>

                <div style={{ "--count": 3 }} className="BarGraphList">
                  <BarGraphItem
                    type="bun"
                    amount={48936}
                    label="requests per second"
                    max={Math.max(48936, 16288, 12289) * 1.25}
                  />
                  <BarGraphItem
                    type="node"
                    amount={16288}
                    label="requests per second"
                    max={Math.max(48936, 16288, 12289) * 1.25}
                  />
                  <BarGraphItem
                    type="deno"
                    amount={12289}
                    label="requests per second"
                    max={Math.max(48936, 16288, 12289) * 1.25}
                  />
                </div>

                <div style={{ "--count": 3 }} className="BarGraphKey">
                  <BarGraphLabel
                    name="bun"
                    version="v0.1.0"
                    source="https://github.com/Jarred-Sumner/bun/blob/main/bench/react-hello-world.jsx"
                  />
                  <BarGraphLabel
                    name="node"
                    version="v18.1.0"
                    source="https://github.com/Jarred-Sumner/bun/blob/main/bench/react-hello-world.node.jsx"
                  />
                  <BarGraphLabel
                    name="deno"
                    version="v1.23.2"
                    source="https://github.com/Jarred-Sumner/bun/blob/main/bench/react-hello-world.deno.jsx"
                  />
                </div>
              </div>

              <div className="BarGraph--sqlite BarGraph BarGraph--horizontal BarGraph--dark">
                <div className="BarGraph-heading">Load a huge table</div>
                <div className="BarGraph-subheading">
                  Average queries per second
                </div>

                <div style={{ "--count": 3 }} className="BarGraphList">
                  <BarGraphItem
                    type="bun"
                    amount={(1000 / 16.6).toFixed(2)}
                    label="queries per second"
                    max={Math.ceil(
                      Math.max(1000 / 16.6, 1000 / 42.96, 1000 / 104.69) * 1.25
                    )}
                  />
                  <BarGraphItem
                    type="better-sqlite3"
                    amount={(1000 / 42.96).toFixed(2)}
                    label="queries per second"
                    max={Math.ceil(
                      Math.max(1000 / 16.6, 1000 / 42.96, 1000 / 104.69) * 1.25
                    )}
                  />
                  <BarGraphItem
                    type="deno"
                    amount={(1000 / 104.69).toFixed(2)}
                    label="queries per second"
                    max={Math.ceil(
                      Math.max(1000 / 16.6, 1000 / 42.96, 1000 / 104.69) * 1.25
                    )}
                  />
                </div>

                <div style={{ "--count": 3 }} className="BarGraphKey">
                  <BarGraphLabel
                    name="bun:sqlite"
                    version="v0.1.0"
                    source="https://github.com/Jarred-Sumner/bun/blob/main/bench/sqlite/query.js"
                  />
                  <BarGraphLabel
                    name="better-sqlite3"
                    source="https://github.com/Jarred-Sumner/bun/blob/main/bench/sqlite/query.node.mjs"
                    version="node v18.2.0"
                  />
                  <BarGraphLabel
                    name="deno (x/sqlite)"
                    version="v1.23.2"
                    source="https://github.com/Jarred-Sumner/bun/blob/main/bench/sqlite/query.deno.js"
                  />
                </div>
              </div>

              <div className="BarGraph BarGraph--ffi BarGraph--horizontal BarGraph--dark">
                <div className="BarGraph-heading">How fast can it get?</div>
                <div className="BarGraph-subheading">Operations per second</div>

                <div style={{ "--count": 3 }} className="BarGraphList">
                  <BarGraphItem
                    type="bun"
                    amount={(115473441).toFixed(2)}
                    label="operations per second"
                    max={Math.ceil(
                      Math.max(115473441, 43478261, 2891761) * 1.25
                    )}
                  />
                  <BarGraphItem
                    type="Node-API"
                    amount={(43478261).toFixed(2)}
                    label="operations per second"
                    max={Math.ceil(
                      Math.max(115473441, 43478261, 2891761) * 1.25
                    )}
                  />
                  <BarGraphItem
                    type="deno"
                    amount={(2891761).toFixed(2)}
                    label="oeprations per iteration"
                    max={Math.ceil(
                      Math.max(115473441, 43478261, 2891761) * 1.25
                    )}
                  />
                </div>

                <div style={{ "--count": 3 }} className="BarGraphKey">
                  <BarGraphLabel
                    name="bun:ffi"
                    version="v0.1.0"
                    source="https://github.com/Jarred-Sumner/bun/blob/f5527c976e20cb60b977cc1b21df079f3e388cc9/bench/ffi/plus100/add3.bun.js"
                  />
                  <BarGraphLabel
                    name="node (napi)"
                    source="https://github.com/Jarred-Sumner/bun/blob/f5527c976e20cb60b977cc1b21df079f3e388cc9/bench/ffi/plus100/add3.napi.mjs"
                    version="node v18.2.0"
                  />
                  <BarGraphLabel
                    name="deno (ffi)"
                    version="v1.23.2"
                    source="https://github.com/Jarred-Sumner/bun/blob/f5527c976e20cb60b977cc1b21df079f3e388cc9/bench/ffi/plus100/add3.deno.js"
                  />
                </div>
              </div>
            </div>
          </div>
          <InstallBox desktop={false} />
        </main>
      </div>
      <section id="explain-section">
        <div id="explain">
          <h1>Tell me more about Bun</h1>
          <p>
            Bun is a modern JavaScript runtime like Node or Deno. It was built
            from scratch to focus on three main things:
          </p>
          <ul>
            <li>Start fast (it has the edge in mind).</li>
            <li>
              New levels of performance (extending JavaScriptCore, the engine).
            </li>
            <li>
              Being a great and complete tool (bundler, transpiler, package
              manager).
            </li>
          </ul>
          <p>
            Bun is designed as a drop-in replacement for your current JavaScript
            &amp; TypeScript apps or scripts — on your local computer, server or
            on the edge. Bun natively implements hundreds of Node.js and Web
            APIs, including ~90% of{" "}
            <a href="https://nodejs.org/api/n-api.html" target="_blank">
              Node-API
            </a>{" "}
            functions (native modules), fs, path, Buffer and more.
          </p>
          <p>
            The goal of Bun is to run most of the worlds JavaScript outside of
            browsers, bringing performance and complexity enhancements to your
            future infrastructure, as well as developer productivity through
            better, simpler tooling.
          </p>
          <h1>Batteries included</h1>
          <ul id="batteries">
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
              In bun.js, every file is transpiled.{" "}
              <TypeScript>TypeScript</TypeScript> &amp; <React>JSX</React> just
              work.
            </li>
            <li>
              bun supports <code className="">"paths"</code>,{" "}
              <code>"jsxImportSource"</code>
              and more from <TypeScript>tsconfig.json</TypeScript> files
            </li>
            <li>
              <Bun>Bun.Transpiler</Bun> bun's JSX &amp; TypeScript transpiler is
              available as an API in Bun.js
            </li>
            <li>
              use the fastest system calls available with <Bun>Bun.write</Bun>{" "}
              to write, copy, pipe, send and clone files.
            </li>
            <li>
              bun.js automatically loads environment variables from{" "}
              <Bun>.env</Bun> files. No more{" "}
              <code class="mono">require("dotenv").load()</code>
            </li>
            <li>
              bun ships with a fast SQLite3 client builtin <Bun>bun:sqlite</Bun>
            </li>
            <li>
              <NodeJS href="https://github.com/Jarred-Sumner/bun/issues/158">
                Node-API
              </NodeJS>{" "}
              bun.js implements most of{' '}
              <a
                href="https://nodejs.org/api/n-api.html#node-api"
                target="_blank"
              >
                Node-API (N-API)
              </a>
              . Many Node.js native modules just work.
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
            Bun's HTTP server is built on web standards like{" "}
            <a
              className="Identifier"
              href="https://developer.mozilla.org/en-US/docs/Web/API/Request"
            >
              Request
            </a>{" "}
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
            and check out <a href={DOCS}>the docs</a>. If you have any questions
            or want help, join{" "}
            <a href="https://bun.sh/discord">Bun's Discord</a>
          </p>

          <h1>Bun CLI</h1>
          <Group title="npm takes 160ms to run a script that does nothing">
            <Command>bun run</Command>
            <p>
              The same command for running JavaScript &amp; TypeScript files
              with bun's JavaScript runtime also runs package.json{" "}
              <code className="mono">"scripts"</code>.
            </p>
            <strong>
              Replace <code className="mono">npm run</code> with{" "}
              <code className="mono">bun run</code> and save 160ms on every run.
            </strong>
            <br />
            <div>
              bun runs package.json scripts{" "}
              <PerformanceClaim href="https://twitter.com/jarredsumner/status/1454218996983623685">
                30x faster than <code className="mono">npm run</code>
              </PerformanceClaim>
            </div>{" "}
          </Group>

          <Group title="JavaScript package managers are not using the fastest system calls">
            <Command>bun install</Command>
            <p>
              bun install is an npm-compatible package manager. You probably
              will be surprised by how much faster copying files can get.
            </p>
            <strong>
              Replace <code className="mono">yarn</code> with{" "}
              <code className="mono">bun install</code> and get 20x faster
              package installs.
            </strong>
            <br />
            <div>
              bun install uses the fastest system calls available to copy files.
            </div>
          </Group>
          <Group>
            <Command>bun wiptest</Command>
            <p>
              A Jest-like test runner for JavaScript &amp; TypeScript projects
              builtin to bun
            </p>
            <Label>
              <PerformanceClaim href="https://twitter.com/jarredsumner/status/1542824445810642946">
                You've never seen a JavaScript test runner this fast
              </PerformanceClaim>{" "}
              (or incomplete)
            </Label>
          </Group>

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
      <script
        dangerouslySetInnerHTML={{
          __html: `
[...document.querySelectorAll(".Tab")].map(el => el.addEventListener("click", function(e) {
  var tab = e.srcElement.getAttribute("data-tab");
  document.querySelector(".Graphs").setAttribute("class", "Graphs Graphs--active-" + tab);
}));

document.querySelector("#code-box-copy").addEventListener("click", async e => {
  var el = document.querySelector("#code-box");
  await navigator.clipboard.writeText("curl https://bun.sh/install | bash");
});
      `,
        }}
      />
      <div className="Built">Built with Bun {process.version}</div>
    </body>
  </html>
);
