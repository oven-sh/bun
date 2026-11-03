// A captured variable that holds a closure or a number is used in many ways and then called in a loop.
process.on("unhandledRejection", () => {});
const one = Date.now() > 0 ? 1 : 2;
async function timed(started, limit) {
  let turns = 0,
    settled = false;
  const count = () => {
    if (!settled && turns < limit) {
      turns++;
      Promise.resolve().then(count);
    }
  };
}
function show(r, depth = 0) {
  if (r === undefined) return "undefined";
  if (typeof r === "string") {
    let t = "string " + r.length + ":";
    for (let i = 0; i < r.length && i < 40; i++) t += r.charCodeAt(i).toString(16) + ".";
    return t;
  }
  let t = "{";
  for (const k of Object.keys(r)) t += k + ":" + show(r[k], depth + 1) + ",";
  return t + "}";
}
function thrown(e) {
  return "threw " + (e instanceof Error ? e.name : show(e));
}
function note(title, answers) {
  const seen = [];
  for (const each of answers) if (!seen.includes(each)) seen.push(each);
  console.log(title + ": " + seen.join(" | "));
}
const turns = process.env.FEWER_TURNS ? 9 : 60,
  attempts = process.env.FEWER_TURNS ? 2 : 6;
function other() {
  return flips++ & 1
    ? 2.5
    : (() => {
        const o = { k: one, m: a => [o.k, a] };
        return o.m;
      })();
}
function use_everyUse(turn) {
  let v = (() => {
    const o = { k: one, m: a => [o.k, a] };
    return o.m;
  })();
  const read = () => {
    let r0,
      r1,
      r2,
      r3,
      r4,
      r5,
      r6,
      r7,
      r8,
      r9,
      r10,
      r11,
      r12,
      r13,
      r14,
      r15,
      r16,
      r17,
      r18,
      r19,
      r20,
      r21,
      r22,
      r23,
      r24,
      r25,
      r26,
      r27,
      r28,
      r29,
      r30,
      r31,
      r32,
      r33,
      r34,
      r35,
      r36,
      r37,
      r38,
      r39,
      r40,
      r41,
      r42,
      r43,
      r44,
      r45,
      r46,
      r47,
      r48,
      r49,
      r50,
      r51,
      r52,
      r53,
      r54,
      r55,
      r56,
      r57,
      r58,
      r59,
      r60,
      r61,
      r62,
      r63,
      r64,
      r65,
      r66,
      r67,
      r68,
      r69,
      r70,
      r71,
      r72,
      r73,
      r74,
      r75,
      r76,
      r77,
      r78,
      r79,
      r80,
      r81,
      r82,
      r83,
      r84,
      r85,
      r86,
      r87,
      r88,
      r89,
      r90,
      r91,
      r92,
      r93,
      r94,
      r95,
      r96,
      r97,
      r98,
      r99,
      r100,
      r101,
      r102,
      r103,
      r104,
      r105,
      r106,
      r107,
      r108,
      r109,
      r110,
      r111,
      r112,
      r113,
      r114,
      r115,
      r116,
      r117,
      r118,
      r119,
      r120,
      r121,
      r122,
      r123,
      r124,
      r125,
      r126,
      r127,
      r128,
      r129,
      r130,
      r131,
      r132,
      r133,
      r134,
      r135,
      r136,
      r137,
      r138,
      r139,
      r140,
      r141,
      r142,
      r143,
      r144,
      r145,
      r146,
      r147,
      r148,
      r149,
      r150,
      r151,
      r152,
      r153,
      r154,
      r155,
      r156,
      r157,
      r158,
      r159,
      r160,
      r161,
      r162,
      r163,
      r164,
      r165,
      r166,
      r167,
      r168,
      r169,
      r170,
      r171,
      r172,
      r173,
      r174,
      r175,
      r176,
      r177,
      r178,
      r179,
      r180,
      r181,
      r182,
      r183,
      r184,
      r185,
      r186,
      r187,
      r188,
      r189,
      r190,
      r191,
      r192,
      r193,
      r194,
      r195,
      r196,
      r197,
      r198,
      r199,
      r200,
      r201,
      r202,
      r203,
      r204,
      r205,
      r206,
      r207,
      r208,
      r209,
      r210,
      r211,
      r212,
      r213,
      r214,
      r215,
      r216,
      r217,
      r218,
      r219,
      r220,
      r221,
      r222,
      r223,
      r224,
      r225,
      r226,
      r227,
      r228,
      r229,
      r230,
      r231,
      r232,
      r233,
      r234,
      r235,
      r236,
      r237,
      r238,
      r239,
      r240,
      r241,
      r242,
      r243,
      r244,
      r245,
      r246,
      r247,
      r248,
      r249,
      r250,
      r251,
      r252,
      r253,
      r254,
      r255,
      r256,
      r257,
      r258,
      r259,
      r260,
      r261,
      r262,
      r263,
      r264,
      r265,
      r266,
      r267,
      r268,
      r269,
      r270,
      r271,
      r272,
      r273,
      r274,
      r275,
      r276,
      r277,
      r278,
      r279,
      r280,
      r281,
      r282,
      r283,
      r284,
      r285,
      r286,
      r287,
      r288,
      r289,
      r290,
      r291,
      r292,
      r293,
      r294,
      r295,
      r296,
      r297,
      r298,
      r299,
      r300,
      r301,
      r302,
      r303,
      r304,
      r305,
      r306,
      r307,
      r308,
      r309,
      r310,
      r311,
      r312,
      r313,
      r314,
      r315,
      r316,
      r317,
      r318,
      r319,
      r320,
      r321,
      r322,
      r323,
      r324,
      r325,
      r326,
      r327,
      r328,
      r329,
      r330,
      r331,
      r332,
      r333,
      r334,
      r335,
      r336,
      r337,
      r338,
      r339,
      r340,
      r341,
      r342,
      r343,
      r344,
      r345,
      r346,
      r347,
      r348,
      r349,
      r350,
      r351,
      r352,
      r353,
      r354,
      r355,
      r356,
      r357,
      r358,
      r359,
      r360,
      r361,
      r362,
      r363,
      r364,
      r365,
      r366,
      r367,
      r368,
      r369,
      r370,
      r371,
      r372,
      r373,
      r374,
      r375,
      r376,
      r377,
      r378,
      r379,
      r380,
      r381,
      r382,
      r383,
      r384,
      r385,
      r386,
      r387,
      r388,
      r389,
      r390,
      r391,
      r392,
      r393,
      r394,
      r395,
      r396,
      r397,
      r398,
      r399,
      r400,
      r401,
      r402,
      r403,
      r404,
      r405,
      r406,
      r407,
      r408;
    try {
      L256: {
        {
          r256 = structuredClone(v);
          break L256;
        }
      }
    } catch (e) {
      r256 = thrown(e);
    }
    try {
      L269: {
        const o = { k: 1, v: v };
        {
          r269 = o.v(1);
          break L269;
        }
      }
    } catch (e) {
      r269 = thrown(e);
    }
    try {
      L270: {
        {
          r270 = "ab".replace(/a/, v);
          break L270;
        }
      }
    } catch (e) {
      r270 = thrown(e);
    }
    try {
      L271: {
        {
          r271 = Object.defineProperty({}, "g", { get: v }).g;
          break L271;
        }
      }
    } catch (e) {
      r271 = thrown(e);
    }
    try {
      L272: {
        {
          r272 = +{ valueOf: v };
          break L272;
        }
      }
    } catch (e) {
      r272 = thrown(e);
    }
    try {
      L273: {
        {
          r273 = [2, 1].sort(v);
          break L273;
        }
      }
    } catch (e) {
      r273 = thrown(e);
    }
    try {
      L274: {
        {
          r274 = {} instanceof v;
          break L274;
        }
      }
    } catch (e) {
      r274 = thrown(e);
    }
    try {
      L275: {
        {
          r275 = typeof class extends v {};
          break L275;
        }
      }
    } catch (e) {
      r275 = thrown(e);
    }
    try {
      L276: {
        {
          r276 = Math.max(v, v);
          break L276;
        }
      }
    } catch (e) {
      r276 = thrown(e);
    }
    try {
      L281: {
        {
          r281 = v(1)?.length;
          break L281;
        }
      }
    } catch (e) {
      r281 = thrown(e);
    }
    try {
      L282: {
        let r;
        for (let i = 0; i < 3; i++) r = v(i);
        {
          r282 = r;
          break L282;
        }
      }
    } catch (e) {
      r282 = thrown(e);
    }
    try {
      L283: {
        {
          r283 = typeof v(v);
          break L283;
        }
      }
    } catch (e) {
      r283 = thrown(e);
    }
    try {
      L284: {
        {
          r284 = new v(1).a;
          break L284;
        }
      }
    } catch (e) {
      r284 = thrown(e);
    }
    try {
      L285: {
        const kept = { f: v };
        {
          r285 = kept.f === v && kept.f(1);
          break L285;
        }
      }
    } catch (e) {
      r285 = thrown(e);
    }
    try {
      L286: {
        {
          r286 = [0, 1, 2].filter(v);
          break L286;
        }
      }
    } catch (e) {
      r286 = thrown(e);
    }
    try {
      L319: {
        {
          r319 = [...Array.prototype.entries.call(v)];
          break L319;
        }
      }
    } catch (e) {
      r319 = thrown(e);
    }
    try {
      L320: {
        const r = Array.prototype.concat.call(v, 1);
        {
          r320 = [r.length, typeof r[0]];
          break L320;
        }
      }
    } catch (e) {
      r320 = thrown(e);
    }
    try {
      L356: {
        let n = 0;
        try {
          try {
            throw v;
          } finally {
            n++;
          }
        } catch (e) {
          {
            r356 = [n, e];
            break L356;
          }
        }
      }
    } catch (e) {
      r356 = thrown(e);
    }
    try {
      L358: {
        throw v;
      }
    } catch (e) {
      r358 = thrown(e);
    }
    try {
      L359: {
        {
          r359 = new Error("w", { cause: v }).cause;
          break L359;
        }
      }
    } catch (e) {
      r359 = thrown(e);
    }
    try {
      L368: {
        let a = v;
        try {
          try {
            thrower(1);
          } finally {
            a = other();
            thrower(a);
          }
        } catch (e) {
          {
            r368 = [a, e === a || e !== e];
            break L368;
          }
        }
      }
    } catch (e) {
      r368 = thrown(e);
    }
    try {
      L369: {
        const deep = (n, x) => (n ? deep(n - 1, x) : thrower(x));
        let a = v,
          b = other();
        try {
          deep(3, a);
        } catch (e) {
          {
            r369 = [a, b, e === a || e !== e];
            break L369;
          }
        }
      }
    } catch (e) {
      r369 = thrown(e);
    }
    try {
      L370: {
        let a = v,
          b = other(),
          n = 0;
        for (let i = 0; i < 4 + extraTurns; i++) {
          try {
            thrower(i & 1 ? a : b);
          } catch (e) {
            [a, b] = [b, e];
            n++;
          }
        }
        {
          r370 = [a, b, n];
          break L370;
        }
      }
    } catch (e) {
      r370 = thrown(e);
    }
    try {
      L371: {
        let a = v,
          b = other();
        try {
          {
            r371 = [a.x.y, b];
            break L371;
          }
        } catch (e) {
          {
            r371 = [a, b, e instanceof TypeError];
            break L371;
          }
        }
      }
    } catch (e) {
      r371 = thrown(e);
    }
    return [
      r0,
      r1,
      r2,
      r3,
      r4,
      r5,
      r6,
      r7,
      r8,
      r9,
      r10,
      r11,
      r12,
      r13,
      r14,
      r15,
      r16,
      r17,
      r18,
      r19,
      r20,
      r21,
      r22,
      r23,
      r24,
      r25,
      r26,
      r27,
      r28,
      r29,
      r30,
      r31,
      r32,
      r33,
      r34,
      r35,
      r36,
      r37,
      r38,
      r39,
      r40,
      r41,
      r42,
      r43,
      r44,
      r45,
      r46,
      r47,
      r48,
      r49,
      r50,
      r51,
      r52,
      r53,
      r54,
      r55,
      r56,
      r57,
      r58,
      r59,
      r60,
      r61,
      r62,
      r63,
      r64,
      r65,
      r66,
      r67,
      r68,
      r69,
      r70,
      r71,
      r72,
      r73,
      r74,
      r75,
      r76,
      r77,
      r78,
      r79,
      r80,
      r81,
      r82,
      r83,
      r84,
      r85,
      r86,
      r87,
      r88,
      r89,
      r90,
      r91,
      r92,
      r93,
      r94,
      r95,
      r96,
      r97,
      r98,
      r99,
      r100,
      r101,
      r102,
      r103,
      r104,
      r105,
      r106,
      r107,
      r108,
      r109,
      r110,
      r111,
      r112,
      r113,
      r114,
      r115,
      r116,
      r117,
      r118,
      r119,
      r120,
      r121,
      r122,
      r123,
      r124,
      r125,
      r126,
      r127,
      r128,
      r129,
      r130,
      r131,
      r132,
      r133,
      r134,
      r135,
      r136,
      r137,
      r138,
      r139,
      r140,
      r141,
      r142,
      r143,
      r144,
      r145,
      r146,
      r147,
      r148,
      r149,
      r150,
      r151,
      r152,
      r153,
      r154,
      r155,
      r156,
      r157,
      r158,
      r159,
      r160,
      r161,
      r162,
      r163,
      r164,
      r165,
      r166,
      r167,
      r168,
      r169,
      r170,
      r171,
      r172,
      r173,
      r174,
      r175,
      r176,
      r177,
      r178,
      r179,
      r180,
      r181,
      r182,
      r183,
      r184,
      r185,
      r186,
      r187,
      r188,
      r189,
      r190,
      r191,
      r192,
      r193,
      r194,
      r195,
      r196,
      r197,
      r198,
      r199,
      r200,
      r201,
      r202,
      r203,
      r204,
      r205,
      r206,
      r207,
      r208,
      r209,
      r210,
      r211,
      r212,
      r213,
      r214,
      r215,
      r216,
      r217,
      r218,
      r219,
      r220,
      r221,
      r222,
      r223,
      r224,
      r225,
      r226,
      r227,
      r228,
      r229,
      r230,
      r231,
      r232,
      r233,
      r234,
      r235,
      r236,
      r237,
      r238,
      r239,
      r240,
      r241,
      r242,
      r243,
      r244,
      r245,
      r246,
      r247,
      r248,
      r249,
      r250,
      r251,
      r252,
      r253,
      r254,
      r255,
      r256,
      r257,
      r258,
      r259,
      r260,
      r261,
      r262,
      r263,
      r264,
      r265,
      r266,
      r267,
      r268,
      r269,
      r270,
      r271,
      r272,
      r273,
      r274,
      r275,
      r276,
      r277,
      r278,
      r279,
      r280,
      r281,
      r282,
      r283,
      r284,
      r285,
      r286,
      r287,
      r288,
      r289,
      r290,
      r291,
      r292,
      r293,
      r294,
      r295,
      r296,
      r297,
      r298,
      r299,
      r300,
      r301,
      r302,
      r303,
      r304,
      r305,
      r306,
      r307,
      r308,
      r309,
      r310,
      r311,
      r312,
      r313,
      r314,
      r315,
      r316,
      r317,
      r318,
      r319,
      r320,
      r321,
      r322,
      r323,
      r324,
      r325,
      r326,
      r327,
      r328,
      r329,
      r330,
      r331,
      r332,
      r333,
      r334,
      r335,
      r336,
      r337,
      r338,
      r339,
      r340,
      r341,
      r342,
      r343,
      r344,
      r345,
      r346,
      r347,
      r348,
      r349,
      r350,
      r351,
      r352,
      r353,
      r354,
      r355,
      r356,
      r357,
      r358,
      r359,
      r360,
      r361,
      r362,
      r363,
      r364,
      r365,
      r366,
      r367,
      r368,
      r369,
      r370,
      r371,
      r372,
      r373,
      r374,
      r375,
      r376,
      r377,
      r378,
      r379,
      r380,
      r381,
      r382,
      r383,
      r384,
      r385,
      r386,
      r387,
      r388,
      r389,
      r390,
      r391,
      r392,
      r393,
      r394,
      r395,
      r396,
      r397,
      r398,
      r399,
      r400,
      r401,
      r402,
      r403,
      r404,
      r405,
      r406,
      r407,
      r408,
    ];
  };
  if (turn % 20 === 7) v = 2.5;
  return read();
}
function attempt_everyUse(n) {
  try {
    return show(use_everyUse(n));
  } catch (e) {
    return thrown(e);
  }
}
{
  const answers = [];
  for (let n = 0; n < turns; n++) answers.push(attempt_everyUse(n));
  note("everyUse", answers);
}
async function use_everyWait(turn) {
  let v = (() => {
    const o = { k: one, m: a => [o.k, a] };
    return o.m;
  })();
  const read = async () => {
    let r0,
      r1,
      r2,
      r3,
      r4,
      r5,
      r6,
      r7,
      r8,
      r9,
      r10,
      r11,
      r12,
      r13,
      r14,
      r15,
      r16,
      r17,
      r18,
      r19,
      r20,
      r21,
      r22,
      r23,
      r24,
      r25,
      r26,
      r27,
      r28,
      r29,
      r30,
      r31,
      r32,
      r33,
      r34,
      r35,
      r36,
      r37,
      r38,
      r39,
      r40,
      r41,
      r42,
      r43,
      r44;
    try {
      L0: {
        {
          r0 = await v;
          break L0;
        }
      }
    } catch (e) {
      r0 = thrown(e);
    }
    try {
      L1: {
        const a = await v;
        const b = await v;
        {
          r1 = [a, b];
          break L1;
        }
      }
    } catch (e) {
      r1 = thrown(e);
    }
    try {
      L2: {
        try {
          {
            r2 = await v;
            break L2;
          }
        } catch (e) {
          {
            r2 = ["caught", e];
            break L2;
          }
        }
      }
    } catch (e) {
      r2 = thrown(e);
    }
    try {
      L3: {
        let n = 0;
        try {
          {
            r3 = await v;
            break L3;
          }
        } finally {
          n++;
        }
      }
    } catch (e) {
      r3 = thrown(e);
    }
    try {
      L4: {
        {
          r4 = (await v) + 1;
          break L4;
        }
      }
    } catch (e) {
      r4 = thrown(e);
    }
    try {
      L5: {
        {
          r5 = `<${await v}>`;
          break L5;
        }
      }
    } catch (e) {
      r5 = thrown(e);
    }
    try {
      L6: {
        {
          r6 = typeof (await v);
          break L6;
        }
      }
    } catch (e) {
      r6 = thrown(e);
    }
    try {
      L7: {
        {
          r7 = (await v)?.length;
          break L7;
        }
      }
    } catch (e) {
      r7 = thrown(e);
    }
    try {
      L8: {
        {
          r8 = (await v)?.(1);
          break L8;
        }
      }
    } catch (e) {
      r8 = thrown(e);
    }
    try {
      L9: {
        {
          r9 = (await v) ? "yes" : "no";
          break L9;
        }
      }
    } catch (e) {
      r9 = thrown(e);
    }
    try {
      L10: {
        {
          r10 = await v(1);
          break L10;
        }
      }
    } catch (e) {
      r10 = thrown(e);
    }
    try {
      L11: {
        {
          r11 = [await v(1), await v(2)];
          break L11;
        }
      }
    } catch (e) {
      r11 = thrown(e);
    }
    try {
      L12: {
        try {
          {
            r12 = await v(1);
            break L12;
          }
        } catch (e) {
          {
            r12 = ["caught", e instanceof Error ? e.name : e];
            break L12;
          }
        }
      }
    } catch (e) {
      r12 = thrown(e);
    }
    try {
      L13: {
        const l = [];
        for await (const x of v(1)) l.push(x);
        {
          r13 = l;
          break L13;
        }
      }
    } catch (e) {
      r13 = thrown(e);
    }
    try {
      L14: {
        {
          r14 = v(1).then(x => [x]);
          break L14;
        }
      }
    } catch (e) {
      r14 = thrown(e);
    }
    try {
      L15: {
        const a = v,
          b = other();
        await null;
        {
          r15 = [a, b];
          break L15;
        }
      }
    } catch (e) {
      r15 = thrown(e);
    }
    try {
      L16: {
        let a = v,
          b = other();
        for (let i = 0; i < 3; i++) {
          await null;
          [a, b] = [b, a];
        }
        {
          r16 = [a, b];
          break L16;
        }
      }
    } catch (e) {
      r16 = thrown(e);
    }
    try {
      L17: {
        let a = v;
        await null;
        const b = a;
        a = other();
        await null;
        {
          r17 = [a, b];
          break L17;
        }
      }
    } catch (e) {
      r17 = thrown(e);
    }
    try {
      L18: {
        let a = v,
          b = other();
        try {
          await null;
          thrower(a);
        } catch (e) {
          {
            r18 = [a, b, e === a || e !== e];
            break L18;
          }
        }
      }
    } catch (e) {
      r18 = thrown(e);
    }
    try {
      L19: {
        let a = v;
        try {
          thrower(1);
        } catch (e) {
          a = [a];
        } finally {
          await null;
        }
        {
          r19 = a;
          break L19;
        }
      }
    } catch (e) {
      r19 = thrown(e);
    }
    try {
      L20: {
        let a = v,
          b = other(),
          c = 1,
          d = 2.5,
          e = v,
          f = other();
        await null;
        [a, b, c, d, e, f] = [f, a, b, c, d, e];
        await null;
        {
          r20 = [a, b, c, d, e, f];
          break L20;
        }
      }
    } catch (e) {
      r20 = thrown(e);
    }
    try {
      L21: {
        {
          r21 = v;
          break L21;
        }
      }
    } catch (e) {
      r21 = thrown(e);
    }
    try {
      L22: {
        try {
          {
            r22 = v;
            break L22;
          }
        } catch (e) {
          {
            r22 = "caught";
            break L22;
          }
        }
      }
    } catch (e) {
      r22 = thrown(e);
    }
    try {
      L23: {
        {
          r23 = v.then(
            x => ["then", x],
            e => ["failed", e],
          );
          break L23;
        }
      }
    } catch (e) {
      r23 = thrown(e);
    }
    try {
      L24: {
        {
          r24 = v.catch(e => ["caught", e]);
          break L24;
        }
      }
    } catch (e) {
      r24 = thrown(e);
    }
    try {
      L25: {
        {
          r25 = Promise.resolve(v);
          break L25;
        }
      }
    } catch (e) {
      r25 = thrown(e);
    }
    try {
      L26: {
        {
          r26 = Promise.resolve(v) === v;
          break L26;
        }
      }
    } catch (e) {
      r26 = thrown(e);
    }
    try {
      L27: {
        {
          r27 = Promise.resolve(v).then(
            x => ["then", x],
            e => ["failed", e],
          );
          break L27;
        }
      }
    } catch (e) {
      r27 = thrown(e);
    }
    try {
      L28: {
        {
          r28 = Promise.reject(v).catch(e => ["caught", e === v || e !== e]);
          break L28;
        }
      }
    } catch (e) {
      r28 = thrown(e);
    }
    try {
      L29: {
        try {
          await Promise.reject(v);
        } catch (e) {
          {
            r29 = ["caught", e === v || e !== e];
            break L29;
          }
        }
      }
    } catch (e) {
      r29 = thrown(e);
    }
    try {
      L30: {
        {
          r30 = Promise.all([v, 2]);
          break L30;
        }
      }
    } catch (e) {
      r30 = thrown(e);
    }
    try {
      L31: {
        {
          r31 = Promise.allSettled([v, 2]);
          break L31;
        }
      }
    } catch (e) {
      r31 = thrown(e);
    }
    try {
      L32: {
        {
          r32 = Promise.race([v]);
          break L32;
        }
      }
    } catch (e) {
      r32 = thrown(e);
    }
    try {
      L33: {
        {
          r33 = Promise.any([v]);
          break L33;
        }
      }
    } catch (e) {
      r33 = thrown(e);
    }
    try {
      L34: {
        const l = [];
        for await (const x of [v, 2]) l.push(x);
        {
          r34 = l;
          break L34;
        }
      }
    } catch (e) {
      r34 = thrown(e);
    }
    try {
      L35: {
        {
          r35 = new Promise(r => r(v));
          break L35;
        }
      }
    } catch (e) {
      r35 = thrown(e);
    }
    try {
      L36: {
        {
          r36 = new Promise(v);
          break L36;
        }
      }
    } catch (e) {
      r36 = thrown(e);
    }
    try {
      L37: {
        {
          r37 = Promise.resolve(1).then(v);
          break L37;
        }
      }
    } catch (e) {
      r37 = thrown(e);
    }
    try {
      L38: {
        {
          r38 = Promise.reject(1).catch(v);
          break L38;
        }
      }
    } catch (e) {
      r38 = thrown(e);
    }
    try {
      L39: {
        {
          r39 = Promise.resolve(1).finally(v);
          break L39;
        }
      }
    } catch (e) {
      r39 = thrown(e);
    }
    try {
      L40: {
        {
          r40 = Promise.resolve(1).then(() => v);
          break L40;
        }
      }
    } catch (e) {
      r40 = thrown(e);
    }
    try {
      L41: {
        throw v;
      }
    } catch (e) {
      r41 = thrown(e);
    }
    try {
      L42: {
        let t = [];
        for (let i = 0; i < 2; i++) t.push(await v);
        {
          r42 = t;
          break L42;
        }
      }
    } catch (e) {
      r42 = thrown(e);
    }
    try {
      L43: {
        {
          r43 = new Promise(r => queueMicrotask(() => r(typeof v)));
          break L43;
        }
      }
    } catch (e) {
      r43 = thrown(e);
    }
    try {
      L44: {
        {
          r44 = await v(1);
          break L44;
        }
      }
    } catch (e) {
      r44 = thrown(e);
    }
    return [
      r0,
      r1,
      r2,
      r3,
      r4,
      r5,
      r6,
      r7,
      r8,
      r9,
      r10,
      r11,
      r12,
      r13,
      r14,
      r15,
      r16,
      r17,
      r18,
      r19,
      r20,
      r21,
      r22,
      r23,
      r24,
      r25,
      r26,
      r27,
      r28,
      r29,
      r30,
      r31,
      r32,
      r33,
      r34,
      r35,
      r36,
      r37,
      r38,
      r39,
      r40,
      r41,
      r42,
      r43,
      r44,
    ];
  };
  if (turn % 20 === 7) v = 2.5;
  return read();
}
async function attempt_everyWait(n) {
  try {
    return show(await timed(use_everyWait(n), 30));
  } catch (e) {
    return thrown(e);
  }
}
{
  const answers = [];
  for (let n = 0; n < turns; n++) answers.push(await attempt_everyWait(n));
  note("everyWait", answers);
}
