import CodeBlock from "../components/CodeBlock";

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
  <li
    className={`BarGraphItem BarGraphItem--${type}`}
    style={{ "--amount": amount, "--max": max }}
  >
    <div className="visually-hidden">{`${type}: ${fmt.format(
      amount
    )} ${label}`}</div>
    <div
      style={{ "--amount": amount, "--max": max }}
      className="BarGraphBar"
      aria-hidden
    >
      <div
        style={{ "--amount": amount, "--max": max }}
        className="BarGraphBar-label"
      >
        {fmt.format(amount)}
      </div>
    </div>
  </li>
);

const BarGraphLabel = ({ name, version, source }) => (
  <a
    href={source}
    target="_blank"
    className="BarGraphKeyItem"
    aria-label={`${name} benchmark source`}
  >
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
    <title>Zig</title>
    <g fill="#F7A41D">
      <g>
        <polygon points="46,22 28,44 19,30" />
        <polygon
          points="46,22 33,33 28,44 22,44 22,95 31,95 20,100 12,117 0,117 0,22"
          shapeRendering="crispEdges"
        />
        <polygon points="31,95 12,117 4,106" />
      </g>
      <g>
        <polygon points="56,22 62,36 37,44" />
        <polygon
          points="56,22 111,22 111,44 37,44 56,32"
          shapeRendering="crispEdges"
        />
        <polygon points="116,95 97,117 90,104" />
        <polygon
          points="116,95 100,104 97,117 42,117 42,95"
          shapeRendering="crispEdges"
        />
        <polygon points="150,0 52,117 3,140 101,22" />
      </g>
      <g>
        <polygon points="141,22 140,40 122,45" />
        <polygon
          points="153,22 153,117 106,117 120,105 125,95 131,95 131,45 122,45 132,36 141,22"
          shapeRendering="crispEdges"
        />
        <polygon points="125,95 130,110 106,117" />
      </g>
    </g>
    <g fill="#121212">
      <g>
        <polygon
          points="260,22 260,37 229,40 177,40 177,22"
          shapeRendering="crispEdges"
        />
        <polygon points="260,37 207,99 207,103 176,103 229,40 229,37" />
        <polygon
          points="261,99 261,117 176,117 176,103 206,99"
          shapeRendering="crispEdges"
        />
      </g>
      <rect x="272" y="22" shapeRendering="crispEdges" width="22" height="95" />
      <g>
        <polygon
          points="394,67 394,106 376,106 376,81 360,70 346,67"
          shapeRendering="crispEdges"
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
  >
    <div className="InstallBox-label">
      <div className="InstallBox-label-heading">
        Install Bun CLI {process.versions.bun} (beta)
      </div>
      <div className="InstallBox-label-subtitle">
        macOS x64 &amp; Silicon, Linux x64, Windows Subsystem for Linux
      </div>
    </div>
    <div className="InstallBox-code-box">
      <div className="InstallBox-curl">curl -fsSL https://bun.sh/install | bash</div>
      <button className="InstallBox-copy" aria-label="Copy installation script">
        copy
      </button>
    </div>
    <a
      className="InstallBox-view-source-link"
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

export default function LandingPage() {
  return (
    <>
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
            <div className="Tabs" role="tablist">
              <button
                data-tab="react"
                id="tab-react"
                aria-controls="react-tab-content"
                className="Tab"
                role="tab"
                aria-selected
                tabIndex={0}
              >
                Bun.serve
              </button>
              <button
                data-tab="websocket"
                id="tab-websocket"
                aria-controls="websocket-tab-content"
                className="Tab"
                role="tab"
                tabIndex={-1}
              >
                WebSocket
              </button>
              <button
                data-tab="sqlite"
                id="tab-sqlite"
                aria-controls="sqlite-tab-content"
                className="Tab"
                role="tab"
                tabIndex={-1}
              >
                bun:sqlite
              </button>
            </div>
            <div id="active-tab" className="ActiveTab">
              <div
                role="tabpanel"
                tabIndex={0}
                id="react-tab-content"
                aria-labelledby="tab-react"
                className="BarGraph BarGraph--react BarGraph--horizontal BarGraph--dark"
              >
                <h2 className="BarGraph-heading">
                  Server-side rendering React
                </h2>
                <p className="BarGraph-subheading">
                  HTTP requests per second (Linux x64)
                </p>

                <ul style={{ "--count": 3 }} className="BarGraphList">
                  <BarGraphItem
                    type="bun"
                    amount={69845}
                    label="requests per second"
                    max={Math.max(69845, 16288, 12926) * 1.25}
                  />
                  <BarGraphItem
                    type="node"
                    amount={16288}
                    label="requests per second"
                    max={Math.max(69845, 16288, 12926) * 1.25}
                  />
                  <BarGraphItem
                    type="deno"
                    amount={12926}
                    label="requests per second"
                    max={Math.max(69845, 16288, 12926) * 1.25}
                  />
                </ul>

                <div style={{ "--count": 3 }} className="BarGraphKey">
                  <BarGraphLabel
                    name="bun"
                    version="v0.2.0"
                    source="https://github.com/oven-sh/bun/blob/b0a7f8df926e91d3b2f0b3b8833ddaf55073f30e/bench/react-hello-world/react-hello-world.jsx#L27"
                  />
                  <BarGraphLabel
                    name="node"
                    version="v18.1.0"
                    source="https://github.com/oven-sh/bun/blob/e55d6eed2bf9a5db30250fdd8b9be063dc949054/bench/react-hello-world/react-hello-world.node.jsx"
                  />
                  <BarGraphLabel
                    name="Deno.serve()"
                    version="v1.26.0"
                    source="https://github.com/oven-sh/bun/blob/af033c02c5fbaade201abfe332f376879d9e6885/bench/react-hello-world/react-hello-world.deno.jsx"
                  />
                </div>
              </div>

              <div
                role="tabpanel"
                tabIndex={-1}
                id="websocket-tab-content"
                aria-labelledby="tab-websocket"
                className="BarGraph BarGraph--websocket BarGraph--horizontal BarGraph--dark"
              >
                <h2 className="BarGraph-heading">WebSocket chat server</h2>
                <p className="BarGraph-subheading">
                  Messages sent per second (Linux x64, 16 clients)
                </p>

                <ul style={{ "--count": 3 }} className="BarGraphList">
                  <BarGraphItem
                    type="bun"
                    amount={(737280).toFixed(2)}
                    label="messages sent per second"
                    max={Math.ceil(Math.max(737280, 107457, 82097) * 1.25)}
                  />
                  <BarGraphItem
                    type="node"
                    amount={(107457).toFixed(2)}
                    label="messages sent per second"
                    max={Math.ceil(Math.max(737280, 107457, 82097) * 1.25)}
                  />
                  <BarGraphItem
                    type="deno"
                    amount={(82097).toFixed(2)}
                    label="messages sent per second"
                    max={Math.ceil(Math.max(737280, 107457, 82097) * 1.25)}
                  />
                </ul>

                <div style={{ "--count": 3 }} className="BarGraphKey">
                  <BarGraphLabel
                    name="Bun.serve()"
                    version="v0.2.1"
                    source="https://github.com/oven-sh/bun/blob/9c7eb75a9ac845d92bfdfd6cc574dc8f39bde293/bench/websocket-server/chat-server.bun.js#L1"
                  />
                  <BarGraphLabel
                    name="ws (Node.js)"
                    version="node v18.10.0"
                    source="https://github.com/oven-sh/bun/blob/9c7eb75a9ac845d92bfdfd6cc574dc8f39bde293/bench/websocket-server/chat-server.node.mjs#L1"
                  />
                  <BarGraphLabel
                    name="Deno.serve()"
                    source="https://github.com/oven-sh/bun/blob/9c7eb75a9ac845d92bfdfd6cc574dc8f39bde293/bench/websocket-server/chat-server.deno.mjs#L1"
                    version="v1.26.2"
                  />
                </div>
              </div>

              <div
                role="tabpanel"
                tabIndex={-1}
                id="sqlite-tab-content"
                aria-labelledby="tab-sqlite"
                className="BarGraph--sqlite BarGraph BarGraph--horizontal BarGraph--dark"
              >
                <h2 className="BarGraph-heading">Load a huge table</h2>
                <p className="BarGraph-subheading">
                  Average queries per second
                </p>

                <ul style={{ "--count": 3 }} className="BarGraphList">
                  <BarGraphItem
                    type="bun"
                    amount={(1000 / 14.22).toFixed(2)}
                    label="queries per second"
                    max={Math.ceil(
                      Math.max(1000 / 14.22, 1000 / 42.96, 1000 / 27.37) * 1.25
                    )}
                  />
                  <BarGraphItem
                    type="deno"
                    amount={(1000 / 27.37).toFixed(2)}
                    label="queries per second"
                    max={Math.ceil(
                      Math.max(1000 / 14.22, 1000 / 42.96, 1000 / 27.37) * 1.25
                    )}
                  />
                  <BarGraphItem
                    type="better-sqlite3"
                    amount={(1000 / 42.96).toFixed(2)}
                    label="queries per second"
                    max={Math.ceil(
                      Math.max(1000 / 14.22, 1000 / 42.96, 1000 / 27.37) * 1.25
                    )}
                  />
                </ul>

                <div style={{ "--count": 3 }} className="BarGraphKey">
                  <BarGraphLabel
                    name="bun:sqlite"
                    version="v0.2.0"
                    source="https://github.com/oven-sh/bun/blob/b0a7f8df926e91d3b2f0b3b8833ddaf55073f30e/bench/sqlite/bun.js#L9"
                  />
                  <BarGraphLabel
                    name="deno (x/sqlite3)"
                    version="v1.26.1"
                    source="https://github.com/oven-sh/bun/blob/6223030360c121e272aad98c7d1c14a009c5fc1c/bench/sqlite/deno.js#L9"
                  />
                  <BarGraphLabel
                    name="better-sqlite3"
                    source="https://github.com/oven-sh/bun/blob/e55d6eed2bf9a5db30250fdd8b9be063dc949054/bench/sqlite/node.mjs"
                    version="node v18.2.0"
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
          <h2>Tell me more about Bun</h2>
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
            The goal of Bun is to run most of the world's JavaScript outside of
            browsers, bringing performance and complexity enhancements to your
            future infrastructure, as well as developer productivity through
            better, simpler tooling.
          </p>
          <h2>Batteries included</h2>
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
              are built-in
            </li>
            <li>
              <NodeJS>node_modules</NodeJS> bun implements Node.js' module
              resolution algorithm, so you can use npm packages in Bun. ESM and
              CommonJS are supported, but Bun internally uses ESM
            </li>
            <li>
              In Bun, every file is transpiled.{" "}
              <TypeScript>TypeScript</TypeScript> &amp; <React>JSX</React> just
              work
            </li>
            <li>
              Bun supports <code>"paths"</code>, <code>"jsxImportSource"</code>
              and more from <TypeScript>tsconfig.json</TypeScript> files
            </li>
            <li>
              <Bun>Bun.Transpiler</Bun> Bun's JSX &amp; TypeScript transpiler is
              available as an API in Bun
            </li>
            <li>
              use the fastest system calls available with <Bun>Bun.write</Bun>{" "}
              to write, copy, pipe, send and clone files
            </li>
            <li>
              Bun automatically loads environment variables from <Bun>.env</Bun>{" "}
              files. No more{" "}
              <code className="mono">require("dotenv").config()</code>
            </li>
            <li>
              Bun ships with a fast SQLite3 client built-in{" "}
              <Bun>bun:sqlite</Bun>
            </li>
            <li>
              <NodeJS href="https://github.com/oven-sh/bun/issues/158">
                Node-API
              </NodeJS>{" "}
              Bun implements most of{" "}
              <a
                href="https://nodejs.org/api/n-api.html#node-api"
                target="_blank"
              >
                Node-API (N-API)
              </a>
              . Many Node.js native modules just work
            </li>
            <li>
              <Bun>bun:ffi</Bun> call native code from JavaScript with Bun's
              low-overhead foreign function interface
            </li>
            <li>
              <NodeJS>node:fs</NodeJS> <NodeJS>node:path</NodeJS> Bun natively
              supports a growing list of Node.js core modules along with globals
              like Buffer and process
            </li>
          </ul>

          <h2>How does Bun work?</h2>
          <p>
            Bun uses the{" "}
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
          <h2>Why is Bun fast?</h2>
          <p>
            An enormous amount of time spent profiling, benchmarking and
            optimizing things. The answer is different for every part of Bun,
            but one general theme:{" "}
            <a href="https://ziglang.org/">
              <Zig></Zig>
            </a>
            's low-level control over memory and lack of hidden control flow
            makes it much simpler to write fast software.{" "}
            <a href="https://github.com/sponsors/ziglang">
              Sponsor the Zig Software Foundation
            </a>
            .
          </p>
          <h2>Getting started</h2>
          <p>
            To install Bun, run this{" "}
            <a target="_blank" href="https://bun.sh/install">
              install script
            </a>{" "}
            in your terminal. It downloads Bun from GitHub.
          </p>
          <CodeBlock lang="shell">{`
curl -fsSL https://bun.sh/install | bash
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
          <p>Run it with Bun:</p>
          <CodeBlock lang="shell">{`bun run http.js`}</CodeBlock>
          <p>
            Then open{" "}
            <a target="_blank" href="http://localhost:3000">
              http://localhost:3000
            </a>{" "}
            in your browser.
            <br />
            <br />
            See{" "}
            <a href="https://github.com/oven-sh/bun/tree/main/examples">
              more examples
            </a>{" "}
            and check out{" "}
            <a href="https://github.com/oven-sh/bun#Reference">the docs</a>. If
            you have any questions or want help, join{" "}
            <a href="https://bun.sh/discord">Bun's Discord</a>.
          </p>

          <h2>Bun CLI</h2>
          <Group>
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
              Bun runs package.json scripts{" "}
              <PerformanceClaim href="https://twitter.com/jarredsumner/status/1454218996983623685">
                30x faster than <code className="mono">npm run</code>
              </PerformanceClaim>
            </div>{" "}
          </Group>

          <Group>
            <Command>bun install</Command>
            <p>
              <code classsName="mono">bun install</code> is an npm-compatible
              package manager. You probably will be surprised by how much faster
              copying files can get.
            </p>
            <strong>
              Replace <code className="mono">yarn</code> with{" "}
              <code className="mono">bun install</code> and get 20x faster
              package installs.
            </strong>
            <br />
            <div>
              <code className="mono">bun install</code> uses the fastest system
              calls available to copy files.
            </div>
          </Group>
          <Group>
            <Command>bun wiptest</Command>
            <p>
              A Jest-like test runner for JavaScript &amp; TypeScript projects
              built-in to Bun.
            </p>
            <Label>
              <PerformanceClaim href="https://twitter.com/jarredsumner/status/1542824445810642946">
                You've never seen a JavaScript test runner this fast
              </PerformanceClaim>{" "}
              (or incomplete).
            </Label>
          </Group>

          <h2>What is the license?</h2>
          <p>
            MIT License, excluding dependencies which have various licenses.
          </p>
          <h2>How do I see the source code?</h2>
          <p>
            Bun is on <a href="https://github.com/oven-sh/bun">GitHub</a>.
          </p>
        </div>
      </section>

      <section id="explain-section">
        <div id="explain"></div>
      </section>
      <script
        dangerouslySetInnerHTML={{
          __html: `
[...document.querySelectorAll(".Tab")].map(el => {
  el.addEventListener("click", function(e) {
    var tab = e.srcElement.getAttribute("data-tab");
    [...document.querySelectorAll(".Tab")].map(el => {
      var active = el.getAttribute("data-tab") === tab;
      el.setAttribute("tabindex", active ? 0 : -1);
      el.setAttribute("aria-selected", active);
    });
    [...document.querySelectorAll(".BarGraph")].map(el => {
      var active = el.id === tab + "-tab-content";
      el.setAttribute("tabindex", active ? 0 : -1);
    });
    document.querySelector(".Graphs").setAttribute("class", "Graphs Graphs--active-" + tab);
  });

  el.addEventListener("keydown", e => {
    var tabs = [...document.querySelectorAll(".Tab")];
    var activeTabEl = document.querySelector(".Tab[aria-selected='true']");
    var activeTabIndex = tabs.indexOf(activeTabEl);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      activeTabIndex = (activeTabIndex + 1) % tabs.length;
      tabs[activeTabIndex].click();
      tabs[activeTabIndex].focus();
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      activeTabIndex = (activeTabIndex + tabs.length - 1) % tabs.length;
      tabs[activeTabIndex].click();
      tabs[activeTabIndex].focus();
    }
    if (e.key === 'Home') {
      e.preventDefault();
      tabs[0].click();
      tabs[0].focus();    
    }
    if (e.key === 'End') {
      e.preventDefault();
      tabs[tabs.length - 1].click();
      tabs[tabs.length - 1].focus();    
    }
  });
});

for (const el of document.querySelectorAll(".InstallBox-copy")) {
  el.addEventListener("click", async e => {
    await navigator.clipboard.writeText("curl -fsSL https://bun.sh/install | bash");
  });
}
      `,
        }}
      />
      <div className="Built">Built with Bun {process.versions.bun}</div>
    </>
  );
}

export const config = {
  unstable_runtimeJS: false,
};
