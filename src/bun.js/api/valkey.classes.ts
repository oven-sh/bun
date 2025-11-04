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
      hsetnx: {
        fn: "hsetnx",
        length: 3,
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
      hgetdel: {
        fn: "hgetdel",
        length: 2,
      },
      hgetex: {
        fn: "hgetex",
        length: 2,
      },
      hsetex: {
        fn: "hsetex",
        length: 3,
      },
      hexpire: {
        fn: "hexpire",
        length: 3,
      },
      hexpireat: {
        fn: "hexpireat",
        length: 3,
      },
      hexpiretime: {
        fn: "hexpiretime",
        length: 2,
      },
      hpersist: {
        fn: "hpersist",
        length: 2,
      },
      hpexpire: {
        fn: "hpexpire",
        length: 3,
      },
      hpexpireat: {
        fn: "hpexpireat",
        length: 3,
      },
      hpexpiretime: {
        fn: "hpexpiretime",
        length: 2,
      },
      hpttl: {
        fn: "hpttl",
        length: 2,
      },
      httl: {
        fn: "httl",
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
        length: 2,
      },
      setbit: {
        fn: "setbit",
        length: 3,
      },
      getrange: {
        fn: "getrange",
        length: 3,
      },
      setrange: {
        fn: "setrange",
        length: 3,
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
        length: 0,
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
        length: 1,
      },
      zcard: {
        fn: "zcard",
      },
      zcount: {
        fn: "zcount",
        length: 3,
      },
      zlexcount: {
        fn: "zlexcount",
        length: 3,
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
      zrem: {
        fn: "zrem",
        length: 2,
      },
      zremrangebylex: {
        fn: "zremrangebylex",
        length: 3,
      },
      zremrangebyrank: {
        fn: "zremrangebyrank",
        length: 3,
      },
      zremrangebyscore: {
        fn: "zremrangebyscore",
        length: 3,
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
        length: 3,
      },
      psetex: {
        fn: "psetex",
        length: 3,
      },
      zscore: {
        fn: "zscore",
      },
      zincrby: {
        fn: "zincrby",
        length: 3,
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
      rename: { fn: "rename", length: 2 },
      renamenx: { fn: "renamenx", length: 2 },
    },
    values: ["onconnect", "onclose", "connectionPromise", "hello", "subscriptionCallbackMap"],
  }),
];
