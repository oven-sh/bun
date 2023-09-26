import { define } from "./scripts/class-definitions";

export default [
    define({
      name: "URL",
      construct: true,
      finalize: true,
      configurable: false,
      klass: {},
      JSType: "0b11101110",
      proto: {
        hash: {
          getter: "getHash",
        },
        host: {
          getter: "getHost",
        },
        hostname: {
          getter: "getHostname",
        },
        href: {
          getter: "getHref",
        },
        origin: {
          getter: "getOrigin",
        },
        password: {
          getter: "getPassword",
        },
        pathname: {
          getter: "getPathname",
        },
        port: {
          getter: "getPortJS",
        },
        protocol: {
          getter: "getProtocol",
        },
        search: {
          getter: "getSearch",
        },
        searchParams: {
          getter: "getSearchParams",
        },
        username: {
          getter: "getUsername",
        },
        ["toJSON"]: {
          fn: "toJSON",
          length: 0,
        },
      },
    })
]