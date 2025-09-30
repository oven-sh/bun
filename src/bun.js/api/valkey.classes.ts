import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "RedisClient",
    construct: true,
    constructNeedsThis: true,
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
      incrby: {
        fn: "incrby",
        length: 2,
      },
      incrbyfloat: {
        fn: "incrbyfloat",
        length: 2,
      },
      decr: {
        fn: "decr",
        length: 1,
      },
      decrby: {
        fn: "decrby",
        length: 2,
      },
      exists: {
        fn: "exists",
        length: 1,
      },
      expire: {
        fn: "expire",
        length: 2,
      },
      expireat: {
        fn: "expireat",
        length: 2,
      },
      pexpire: {
        fn: "pexpire",
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
        length: 2,
      },
      hset: {
        fn: "hset",
        length: 2,
      },
      hget: {
        fn: "hget",
        length: 2,
      },
      hmget: {
        fn: "hmget",
        length: 2,
      },
      hdel: {
        fn: "hdel",
        length: 2,
      },
      hexists: {
        fn: "hexists",
        length: 2,
      },
      hrandfield: {
        fn: "hrandfield",
        length: 1,
      },
      hscan: {
        fn: "hscan",
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
      blmove: {
        fn: "blmove",
        length: 5,
      },
      blmpop: {
        fn: "blmpop",
        length: 3,
      },
      blpop: {
        fn: "blpop",
        length: 2,
      },
      brpop: {
        fn: "brpop",
        length: 2,
      },
      brpoplpush: {
        fn: "brpoplpush",
        length: 3,
      },
      getbit: {
        fn: "getbit",
      },
      setbit: {
        fn: "setbit",
      },
      getrange: {
        fn: "getrange",
      },
      setrange: {
        fn: "setrange",
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
      lindex: {
        fn: "lindex",
        length: 2,
      },
      linsert: {
        fn: "linsert",
        length: 4,
      },
      llen: {
        fn: "llen",
      },
      lmove: {
        fn: "lmove",
        length: 4,
      },
      lmpop: {
        fn: "lmpop",
        length: 2,
      },
      lpop: {
        fn: "lpop",
      },
      lpos: {
        fn: "lpos",
        length: 2,
      },
      lrange: {
        fn: "lrange",
        length: 3,
      },
      lrem: {
        fn: "lrem",
        length: 3,
      },
      lset: {
        fn: "lset",
        length: 3,
      },
      ltrim: {
        fn: "ltrim",
        length: 3,
      },
      persist: {
        fn: "persist",
      },
      pexpireat: {
        fn: "pexpireat",
        length: 2,
      },
      pexpiretime: {
        fn: "pexpiretime",
      },
      pttl: {
        fn: "pttl",
      },
      randomkey: {
        fn: "randomkey",
      },
      rpop: {
        fn: "rpop",
      },
      rpoplpush: {
        fn: "rpoplpush",
        length: 2,
      },
      scan: {
        fn: "scan",
      },
      scard: {
        fn: "scard",
      },
      sdiff: {
        fn: "sdiff",
        length: 1,
      },
      sdiffstore: {
        fn: "sdiffstore",
        length: 2,
      },
      sinter: {
        fn: "sinter",
        length: 1,
      },
      sintercard: {
        fn: "sintercard",
        length: 1,
      },
      sinterstore: {
        fn: "sinterstore",
        length: 2,
      },
      smismember: {
        fn: "smismember",
        length: 2,
      },
      sscan: {
        fn: "sscan",
        length: 2,
      },
      strlen: {
        fn: "strlen",
      },
      sunion: {
        fn: "sunion",
        length: 1,
      },
      sunionstore: {
        fn: "sunionstore",
        length: 2,
      },
      type: {
        fn: "type",
      },
      zcard: {
        fn: "zcard",
      },
      zcount: {
        fn: "zcount",
      },
      zlexcount: {
        fn: "zlexcount",
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
      zrange: {
        fn: "zrange",
        length: 3,
      },
      zrangebylex: {
        fn: "zrangebylex",
        length: 3,
      },
      zrangebyscore: {
        fn: "zrangebyscore",
        length: 3,
      },
      zrangestore: {
        fn: "zrangestore",
        length: 4,
      },
      zrevrange: {
        fn: "zrevrange",
        length: 3,
      },
      zrevrangebylex: {
        fn: "zrevrangebylex",
        length: 3,
      },
      zrevrangebyscore: {
        fn: "zrevrangebyscore",
        length: 3,
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
      setex: {
        fn: "setex",
      },
      psetex: {
        fn: "psetex",
      },
      zscore: {
        fn: "zscore",
      },
      zincrby: {
        fn: "zincrby",
      },
      zmscore: {
        fn: "zmscore",
      },
      zadd: {
        fn: "zadd",
        length: 3,
      },
      zscan: {
        fn: "zscan",
        length: 2,
      },
      zdiff: {
        fn: "zdiff",
        length: 1,
      },
      zdiffstore: {
        fn: "zdiffstore",
        length: 2,
      },
      zinter: {
        fn: "zinter",
        length: 2,
      },
      zintercard: {
        fn: "zintercard",
        length: 1,
      },
      zinterstore: {
        fn: "zinterstore",
        length: 3,
      },
      zunion: {
        fn: "zunion",
        length: 2,
      },
      zunionstore: {
        fn: "zunionstore",
        length: 3,
      },
      zmpop: {
        fn: "zmpop",
        length: 2,
      },
      bzmpop: {
        fn: "bzmpop",
        length: 3,
      },
      bzpopmin: {
        fn: "bzpopmin",
        length: 2,
      },
      bzpopmax: {
        fn: "bzpopmax",
        length: 2,
      },
      mget: {
        fn: "mget",
      },
      mset: {
        fn: "mset",
      },
      msetnx: {
        fn: "msetnx",
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
      zrem: { fn: "zrem" },
      zremrangebylex: { fn: "zremrangebylex" },
      zremrangebyrank: { fn: "zremrangebyrank" },
      zremrangebyscore: { fn: "zremrangebyscore" },
      zrevrank: { fn: "zrevrank" },
      subscribe: { fn: "subscribe" },
      duplicate: { fn: "duplicate" },
      psubscribe: { fn: "psubscribe" },
      unsubscribe: { fn: "unsubscribe" },
      punsubscribe: { fn: "punsubscribe" },
      pubsub: { fn: "pubsub" },
      copy: { fn: "copy" },
      unlink: { fn: "unlink" },
      touch: { fn: "touch" },
      rename: { fn: "rename" },
      renamenx: { fn: "renamenx" },
    },
    values: ["onconnect", "onclose", "connectionPromise", "hello", "subscriptionCallbackMap"],
  }),
];
