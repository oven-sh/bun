import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "RedisClient",
    construct: true,
    call: false,
    finalize: true,
    configurable: false,
    JSType: "0b11101110",
    memoryCost: true,
    proto: {
      connected: {
        getter: "getConnected",
      },
      onconnect: {
        getter: "getOnConnect",
        setter: "setOnConnect",
        this: true,
      },
      onclose: {
        getter: "getOnClose",
        setter: "setOnClose",
        this: true,
      },
      bufferedAmount: {
        getter: "getBufferedAmount",
      },
      // Valkey commands
      get: {
        fn: "get",
        length: 1,
      },
      getBuffer: {
        fn: "getBuffer",
        length: 1,
      },
      set: {
        fn: "set",
        length: 2,
      },
      del: {
        fn: "del",
        length: 1,
      },
      incr: {
        fn: "incr",
        length: 1,
      },
      decr: {
        fn: "decr",
        length: 1,
      },
      exists: {
        fn: "exists",
        length: 1,
      },
      expire: {
        fn: "expire",
        length: 2,
      },
      connect: {
        fn: "jsConnect",
        length: 0,
      },
      close: {
        fn: "jsDisconnect",
        length: 0,
      },
      send: {
        fn: "jsSend",
        length: 2,
      },
      ttl: {
        fn: "ttl",
        length: 1,
      },
      hmset: {
        fn: "hmset",
        length: 3,
      },
      hmget: {
        fn: "hmget",
        length: 2,
      },
      sismember: {
        fn: "sismember",
        length: 2,
      },
      sadd: {
        fn: "sadd",
        length: 2,
      },
      srem: {
        fn: "srem",
        length: 2,
      },
      smembers: {
        fn: "smembers",
        length: 1,
      },
      srandmember: {
        fn: "srandmember",
        length: 1,
      },
      spop: {
        fn: "spop",
        length: 1,
      },
      hincrby: {
        fn: "hincrby",
        length: 3,
      },
      hincrbyfloat: {
        fn: "hincrbyfloat",
        length: 3,
      },
      bitcount: {
        fn: "bitcount",
      },
      dump: {
        fn: "dump",
      },
      expiretime: {
        fn: "expiretime",
      },
      getdel: {
        fn: "getdel",
      },
      getex: {
        fn: "getex",
      },
      hgetall: {
        fn: "hgetall",
      },
      hkeys: {
        fn: "hkeys",
      },
      hlen: {
        fn: "hlen",
      },
      hvals: {
        fn: "hvals",
      },
      keys: {
        fn: "keys",
      },
      llen: {
        fn: "llen",
      },
      lpop: {
        fn: "lpop",
      },
      persist: {
        fn: "persist",
      },
      pexpiretime: {
        fn: "pexpiretime",
      },
      pttl: {
        fn: "pttl",
      },
      rpop: {
        fn: "rpop",
      },
      scard: {
        fn: "scard",
      },
      strlen: {
        fn: "strlen",
      },
      zcard: {
        fn: "zcard",
      },
      zpopmax: {
        fn: "zpopmax",
      },
      zpopmin: {
        fn: "zpopmin",
      },
      zrandmember: {
        fn: "zrandmember",
      },
      append: {
        fn: "append",
      },
      getset: {
        fn: "getset",
      },
      lpush: {
        fn: "lpush",
      },
      lpushx: {
        fn: "lpushx",
      },
      pfadd: {
        fn: "pfadd",
      },
      rpush: {
        fn: "rpush",
      },
      rpushx: {
        fn: "rpushx",
      },
      setnx: {
        fn: "setnx",
      },
      zscore: {
        fn: "zscore",
      },
      mget: {
        fn: "mget",
      },
      ping: { fn: "ping" },
      publish: { fn: "publish" },
      script: { fn: "script" },
      select: { fn: "select" },
      spublish: { fn: "spublish" },
      smove: { fn: "smove" },
      substr: { fn: "substr" },
      hstrlen: { fn: "hstrlen" },
      zrank: { fn: "zrank" },
      zrevrank: { fn: "zrevrank" },
      subscribe: { fn: "subscribe" },
      psubscribe: { fn: "psubscribe" },
      unsubscribe: { fn: "unsubscribe" },
      punsubscribe: { fn: "punsubscribe" },
      pubsub: { fn: "pubsub" },
    },
    values: ["onconnect", "onclose", "connectionPromise", "hello"],
  }),
];
