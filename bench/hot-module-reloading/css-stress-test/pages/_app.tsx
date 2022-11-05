// @ts-nocheck
import "../src/index.css";

import App from "next/app";

class MyApp extends App {
  render() {
    const { Component, pageProps } = this.props;
    return <Component {...pageProps} />;
  }
}

export default MyApp;
