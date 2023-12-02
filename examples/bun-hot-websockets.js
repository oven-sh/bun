// To run this example:
//
//   bun --hot bun-hot-websockets.js
//

const css = ([inner]) => {
  return inner;
};

const styles = css`
  #bun {
    margin: 0 auto;
    margin-top: 200px;
    object-fit: cover;
  }
  html,
  body {
    margin: 0;
    padding: 0;
  }
  body {
    background: #f1239f;
    font-family: "Inter", sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    align-content: center;
    color: white;
  }
  h1 {
    padding: 0;
    text-align: center;
    font-size: 3rem;
    -webkit-text-stroke: 2px black;
  }
  * {
    box-sizing: border-box;
  }
`;

Bun.serve({
  websocket: {
    message(ws, msg) {
      ws.send(styles);
    },
  },
  fetch(req, server) {
    if (req.url.endsWith("/hot")) {
      if (server.upgrade(req))
        return new Response("", {
          status: 101,
        });
    }

    return new Response(
      `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>WebSockets</title>
    </head>
    <body>
      <style></style>
        <script>
            const ws = new WebSocket("ws://localhost:3000/hot");
            const style = document.querySelector("style");
            ws.onmessage = (e) => {
              style.innerHTML = e.data;
            };
            setInterval(() => {
                ws.send("ping");
            }, 8);
        </script>
        <div id="app">
            <img src="https://bun.sh/logo.svg" alt="Bun" id='bun'  />
            <h1>bun --hot websockets</h1>
        </div>
    </body>
        
    `,
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
        },
      },
    );
  },
});
