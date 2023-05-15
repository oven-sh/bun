import React, { useState } from "react";
{
  /* <div style={{display: "flex", flexDirection: "column"}}>
          <h1>{props.title}</h1>
          <Counter />
          <p>
            <a href="/">Home</a>
          </p>
          <p>
            <a href="/settings">Settings</a>
          </p>
        </div> */
}
export function Layout(props: { title: string; children: React.ReactNode }) {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <link rel="icon" href="favicon.ico" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#000000" />
        <meta name="description" content="Web site created using create-react-app" />
        <link rel="apple-touch-icon" href="/logo192.png" />
        <link rel="manifest" href="/manifest.json" />
        <title>{props.title}</title>
        <link rel="stylesheet" href="/index.css" />
      </head>
      <body>
        <div className="App" role="main">
          <article className="App-article">
            <img src={"/bunlogo.svg"} className="App-logo" alt="logo" />

            <div style={{ height: "30px" }}></div>
            <h3>{props.title}</h3>

            <div style={{ height: "30px" }}></div>
            {props.children}
          </article>
        </div>
      </body>
    </html>
  );
}
