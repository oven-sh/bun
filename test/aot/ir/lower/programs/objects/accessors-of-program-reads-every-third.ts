// RUN: lower
// OPTIONS: builtin-modules

// A typed view of the environment: an object with a getter for each declared name, built by one function for several tables of names.
type Field = { parse(raw: string | undefined): unknown };
const flag: Field = { parse: raw => raw === "1" || raw === "true" };
const text: Field = { parse: raw => raw };
const count: Field = { parse: raw => (raw === undefined ? undefined : Number(raw)) };
const paths = { HOME: text, PATH: text, USER: text };
const switches = { NOT_THERE_1: flag, NOT_THERE_2: flag, NOT_THERE_3: flag, LAZY_GETTERS: flag, SWITCH_0: flag, SWITCH_1: flag, SWITCH_2: flag, SWITCH_3: flag, SWITCH_4: flag, SWITCH_5: flag, SWITCH_6: flag, SWITCH_7: flag, SWITCH_8: flag, SWITCH_9: flag, SWITCH_10: flag, SWITCH_11: flag, SWITCH_12: flag, SWITCH_13: flag, SWITCH_14: flag, SWITCH_15: flag, SWITCH_16: flag, SWITCH_17: flag, SWITCH_18: flag, SWITCH_19: flag, SWITCH_20: flag, SWITCH_21: flag, SWITCH_22: flag, SWITCH_23: flag, SWITCH_24: flag, SWITCH_25: flag, SWITCH_26: flag, SWITCH_27: flag, SWITCH_28: flag, SWITCH_29: flag, SWITCH_30: flag, SWITCH_31: flag, SWITCH_32: flag, SWITCH_33: flag, SWITCH_34: flag, SWITCH_35: flag, SWITCH_36: flag, SWITCH_37: flag, SWITCH_38: flag, SWITCH_39: flag, SWITCH_40: flag, SWITCH_41: flag, SWITCH_42: flag, SWITCH_43: flag, SWITCH_44: flag, SWITCH_45: flag, SWITCH_46: flag, SWITCH_47: flag, SWITCH_48: flag, SWITCH_49: flag, SWITCH_50: flag, SWITCH_51: flag, SWITCH_52: flag, SWITCH_53: flag, SWITCH_54: flag, SWITCH_55: flag, SWITCH_56: flag, SWITCH_57: flag, SWITCH_58: flag, SWITCH_59: flag, SWITCH_60: flag, SWITCH_61: flag, SWITCH_62: flag, SWITCH_63: flag, SWITCH_64: flag, SWITCH_65: flag, SWITCH_66: flag, SWITCH_67: flag, SWITCH_68: flag, SWITCH_69: flag, SWITCH_70: flag, SWITCH_71: flag, SWITCH_72: flag, SWITCH_73: flag, SWITCH_74: flag, SWITCH_75: flag, SWITCH_76: flag, SWITCH_77: flag, SWITCH_78: flag, SWITCH_79: flag, SWITCH_80: flag, SWITCH_81: flag, SWITCH_82: flag, SWITCH_83: flag, SWITCH_84: flag, SWITCH_85: flag, SWITCH_86: flag, SWITCH_87: flag, SWITCH_88: flag, SWITCH_89: flag, SWITCH_90: flag, SWITCH_91: flag, SWITCH_92: flag, SWITCH_93: flag, SWITCH_94: flag, SWITCH_95: flag, SWITCH_96: flag, SWITCH_97: flag, SWITCH_98: flag, SWITCH_99: flag, SWITCH_100: flag, SWITCH_101: flag, SWITCH_102: flag, SWITCH_103: flag, SWITCH_104: flag, SWITCH_105: flag, SWITCH_106: flag, SWITCH_107: flag, SWITCH_108: flag, SWITCH_109: flag, SWITCH_110: flag, SWITCH_111: flag, SWITCH_112: flag, SWITCH_113: flag, SWITCH_114: flag, SWITCH_115: flag, SWITCH_116: flag, SWITCH_117: flag, SWITCH_118: flag, SWITCH_119: flag, SWITCH_120: flag, SWITCH_121: flag, SWITCH_122: flag, SWITCH_123: flag, SWITCH_124: flag, SWITCH_125: flag, SWITCH_126: flag, SWITCH_127: flag, SWITCH_128: flag, SWITCH_129: flag, SWITCH_130: flag, SWITCH_131: flag, SWITCH_132: flag, SWITCH_133: flag, SWITCH_134: flag, SWITCH_135: flag, SWITCH_136: flag, SWITCH_137: flag, SWITCH_138: flag, SWITCH_139: flag, SWITCH_140: flag, SWITCH_141: flag, SWITCH_142: flag, SWITCH_143: flag, SWITCH_144: flag, SWITCH_145: flag, SWITCH_146: flag, SWITCH_147: flag, SWITCH_148: flag, SWITCH_149: flag, SWITCH_150: flag, SWITCH_151: flag, SWITCH_152: flag, SWITCH_153: flag, SWITCH_154: flag, SWITCH_155: flag, SWITCH_156: flag, SWITCH_157: flag, SWITCH_158: flag, SWITCH_159: flag, SWITCH_160: flag, SWITCH_161: flag, SWITCH_162: flag, SWITCH_163: flag, SWITCH_164: flag, SWITCH_165: flag, SWITCH_166: flag, SWITCH_167: flag, SWITCH_168: flag, SWITCH_169: flag, SWITCH_170: flag, SWITCH_171: flag, SWITCH_172: flag, SWITCH_173: flag, SWITCH_174: flag, SWITCH_175: flag, SWITCH_176: flag, SWITCH_177: flag, SWITCH_178: flag, SWITCH_179: flag, SWITCH_180: flag, SWITCH_181: flag, SWITCH_182: flag, SWITCH_183: flag, SWITCH_184: flag, SWITCH_185: flag, SWITCH_186: flag, SWITCH_187: flag, SWITCH_188: flag, SWITCH_189: flag, SWITCH_190: flag, SWITCH_191: flag, SWITCH_192: flag, SWITCH_193: flag, SWITCH_194: flag, SWITCH_195: flag, SWITCH_196: flag, SWITCH_197: flag, SWITCH_198: flag, SWITCH_199: flag, SWITCH_200: flag, SWITCH_201: flag, SWITCH_202: flag, SWITCH_203: flag, SWITCH_204: flag, SWITCH_205: flag, SWITCH_206: flag, SWITCH_207: flag, SWITCH_208: flag, SWITCH_209: flag, SWITCH_210: flag, SWITCH_211: flag, SWITCH_212: flag, SWITCH_213: flag, SWITCH_214: flag, SWITCH_215: flag, SWITCH_216: flag, SWITCH_217: flag, SWITCH_218: flag, SWITCH_219: flag, SWITCH_220: flag, SWITCH_221: flag, SWITCH_222: flag, SWITCH_223: flag, SWITCH_224: flag, SWITCH_225: flag, SWITCH_226: flag, SWITCH_227: flag, SWITCH_228: flag, SWITCH_229: flag, SWITCH_230: flag, SWITCH_231: flag, SWITCH_232: flag, SWITCH_233: flag, SWITCH_234: flag, SWITCH_235: flag, SWITCH_236: flag, SWITCH_237: flag, SWITCH_238: flag, SWITCH_239: flag, SWITCH_240: flag, SWITCH_241: flag, SWITCH_242: flag, SWITCH_243: flag, SWITCH_244: flag, SWITCH_245: flag, SWITCH_246: flag, SWITCH_247: flag, SWITCH_248: flag, SWITCH_249: flag, SWITCH_250: flag, SWITCH_251: flag, SWITCH_252: flag, SWITCH_253: flag, SWITCH_254: flag, SWITCH_255: flag, SWITCH_256: flag, SWITCH_257: flag, SWITCH_258: flag, SWITCH_259: flag, SWITCH_260: flag, SWITCH_261: flag, SWITCH_262: flag, SWITCH_263: flag, SWITCH_264: flag, SWITCH_265: flag, SWITCH_266: flag, SWITCH_267: flag, SWITCH_268: flag, SWITCH_269: flag, SWITCH_270: flag, SWITCH_271: flag, SWITCH_272: flag, SWITCH_273: flag, SWITCH_274: flag, SWITCH_275: flag, SWITCH_276: flag, SWITCH_277: flag, SWITCH_278: flag, SWITCH_279: flag, SWITCH_280: flag, SWITCH_281: flag, SWITCH_282: flag, SWITCH_283: flag, SWITCH_284: flag, SWITCH_285: flag, SWITCH_286: flag, SWITCH_287: flag, SWITCH_288: flag, SWITCH_289: flag, SWITCH_290: flag, SWITCH_291: flag, SWITCH_292: flag, SWITCH_293: flag, SWITCH_294: flag, SWITCH_295: flag, SWITCH_296: flag, SWITCH_297: flag, SWITCH_298: flag, SWITCH_299: flag, SWITCH_300: flag, SWITCH_301: flag, SWITCH_302: flag, SWITCH_303: flag, SWITCH_304: flag, SWITCH_305: flag, SWITCH_306: flag, SWITCH_307: flag, SWITCH_308: flag, SWITCH_309: flag, SWITCH_310: flag, SWITCH_311: flag, SWITCH_312: flag, SWITCH_313: flag, SWITCH_314: flag, SWITCH_315: flag, SWITCH_316: flag, SWITCH_317: flag, SWITCH_318: flag, SWITCH_319: flag, SWITCH_320: flag, SWITCH_321: flag, SWITCH_322: flag, SWITCH_323: flag, SWITCH_324: flag, SWITCH_325: flag, SWITCH_326: flag, SWITCH_327: flag, SWITCH_328: flag, SWITCH_329: flag, SWITCH_330: flag, SWITCH_331: flag, SWITCH_332: flag, SWITCH_333: flag, SWITCH_334: flag, SWITCH_335: flag, SWITCH_336: flag, SWITCH_337: flag, SWITCH_338: flag, SWITCH_339: flag, SWITCH_340: flag, SWITCH_341: flag, SWITCH_342: flag, SWITCH_343: flag, SWITCH_344: flag, SWITCH_345: flag, SWITCH_346: flag, SWITCH_347: flag, SWITCH_348: flag, SWITCH_349: flag, SWITCH_350: flag, SWITCH_351: flag, SWITCH_352: flag, SWITCH_353: flag, SWITCH_354: flag, SWITCH_355: flag, SWITCH_356: flag, SWITCH_357: flag, SWITCH_358: flag, SWITCH_359: flag, SWITCH_360: flag, SWITCH_361: flag, SWITCH_362: flag, SWITCH_363: flag, SWITCH_364: flag, SWITCH_365: flag, SWITCH_366: flag, SWITCH_367: flag, SWITCH_368: flag, SWITCH_369: flag, SWITCH_370: flag, SWITCH_371: flag, SWITCH_372: flag, SWITCH_373: flag, SWITCH_374: flag, SWITCH_375: flag, SWITCH_376: flag, SWITCH_377: flag, SWITCH_378: flag, SWITCH_379: flag, SWITCH_380: flag, SWITCH_381: flag, SWITCH_382: flag, SWITCH_383: flag, SWITCH_384: flag, SWITCH_385: flag, SWITCH_386: flag, SWITCH_387: flag, SWITCH_388: flag, SWITCH_389: flag, SWITCH_390: flag, SWITCH_391: flag, SWITCH_392: flag, SWITCH_393: flag, SWITCH_394: flag, SWITCH_395: flag, SWITCH_396: flag, SWITCH_397: flag, SWITCH_398: flag, SWITCH_399: flag };
const numbers = { SHLVL: count, NOT_THERE_4: count };
const SHAPE = { ...paths, ...switches, ...numbers };
const OTHER_SHAPE = { LANG: text, NOT_THERE_5: flag };
const shapes = new WeakMap<object, Record<string, Field> | null>();

function getterFor(key: string, field: Field, unread: object): () => unknown {
  let lastRaw: unknown = unread;
  let lastParsed: unknown;
  return () => {
    const raw = process.env[key];
    if (raw !== lastRaw) {
      lastParsed = field.parse(raw);
      lastRaw = raw;
    }
    return lastParsed;
  };
}
function isShapeKey(shape: Record<string, Field>, key: string | symbol): key is string {
  return typeof key === "string" && Object.hasOwn(shape, key);
}
function lazyAccessor(shape: Record<string, Field>, proto: object | null): Record<string, unknown> {
  const keys = new Proxy(Object.create(proto), {
    get: (target, key, receiver) => {
      if (!isShapeKey(shape, key)) return Reflect.get(target, key, receiver);
      const read = getterFor(key, shape[key]!, accessor);
      if (receiver === accessor) Object.defineProperty(accessor, key, { get: read, configurable: true });
      return read();
    },
    has: (target, key) => isShapeKey(shape, key) || Reflect.has(target, key),
  });
  const accessor: Record<string, unknown> = Object.create(keys);
  return accessor;
}
function build(shape: Record<string, Field>, proto: object | null, lazy = switches.LAZY_GETTERS.parse(process.env["LAZY_GETTERS"]) === true): Record<string, unknown> {
  const accessor = lazy ? lazyAccessor(shape, proto) : (Object.create(proto) as Record<string, unknown>);
  for (const [key, field] of lazy ? [] : Object.entries(shape)) {
    Object.defineProperty(accessor, key, { get: getterFor(key, field, accessor), enumerable: true, configurable: true });
  }
  shapes.set(accessor, lazy ? shape : null);
  Object.defineProperties(accessor, {
    set: { value: (key: string, value: string | number | boolean) => { process.env[key] = String(value); } },
    unset: { value: (key: string) => { delete process.env[key]; } },
  });
  return accessor;
}
const runtime = { platform: process.platform, isCI: false };
type Settings = { HOME: string; PATH: string; USER: string; NOT_THERE_1: boolean; NOT_THERE_2: boolean; NOT_THERE_3: boolean; LAZY_GETTERS: boolean; SWITCH_0: boolean; SWITCH_1: boolean; SWITCH_2: boolean; SWITCH_3: boolean; SWITCH_4: boolean; SWITCH_5: boolean; SWITCH_6: boolean; SWITCH_7: boolean; SWITCH_8: boolean; SWITCH_9: boolean; SWITCH_10: boolean; SWITCH_11: boolean; SWITCH_12: boolean; SWITCH_13: boolean; SWITCH_14: boolean; SWITCH_15: boolean; SWITCH_16: boolean; SWITCH_17: boolean; SWITCH_18: boolean; SWITCH_19: boolean; SWITCH_20: boolean; SWITCH_21: boolean; SWITCH_22: boolean; SWITCH_23: boolean; SWITCH_24: boolean; SWITCH_25: boolean; SWITCH_26: boolean; SWITCH_27: boolean; SWITCH_28: boolean; SWITCH_29: boolean; SWITCH_30: boolean; SWITCH_31: boolean; SWITCH_32: boolean; SWITCH_33: boolean; SWITCH_34: boolean; SWITCH_35: boolean; SWITCH_36: boolean; SWITCH_37: boolean; SWITCH_38: boolean; SWITCH_39: boolean; SWITCH_40: boolean; SWITCH_41: boolean; SWITCH_42: boolean; SWITCH_43: boolean; SWITCH_44: boolean; SWITCH_45: boolean; SWITCH_46: boolean; SWITCH_47: boolean; SWITCH_48: boolean; SWITCH_49: boolean; SWITCH_50: boolean; SWITCH_51: boolean; SWITCH_52: boolean; SWITCH_53: boolean; SWITCH_54: boolean; SWITCH_55: boolean; SWITCH_56: boolean; SWITCH_57: boolean; SWITCH_58: boolean; SWITCH_59: boolean; SWITCH_60: boolean; SWITCH_61: boolean; SWITCH_62: boolean; SWITCH_63: boolean; SWITCH_64: boolean; SWITCH_65: boolean; SWITCH_66: boolean; SWITCH_67: boolean; SWITCH_68: boolean; SWITCH_69: boolean; SWITCH_70: boolean; SWITCH_71: boolean; SWITCH_72: boolean; SWITCH_73: boolean; SWITCH_74: boolean; SWITCH_75: boolean; SWITCH_76: boolean; SWITCH_77: boolean; SWITCH_78: boolean; SWITCH_79: boolean; SWITCH_80: boolean; SWITCH_81: boolean; SWITCH_82: boolean; SWITCH_83: boolean; SWITCH_84: boolean; SWITCH_85: boolean; SWITCH_86: boolean; SWITCH_87: boolean; SWITCH_88: boolean; SWITCH_89: boolean; SWITCH_90: boolean; SWITCH_91: boolean; SWITCH_92: boolean; SWITCH_93: boolean; SWITCH_94: boolean; SWITCH_95: boolean; SWITCH_96: boolean; SWITCH_97: boolean; SWITCH_98: boolean; SWITCH_99: boolean; SWITCH_100: boolean; SWITCH_101: boolean; SWITCH_102: boolean; SWITCH_103: boolean; SWITCH_104: boolean; SWITCH_105: boolean; SWITCH_106: boolean; SWITCH_107: boolean; SWITCH_108: boolean; SWITCH_109: boolean; SWITCH_110: boolean; SWITCH_111: boolean; SWITCH_112: boolean; SWITCH_113: boolean; SWITCH_114: boolean; SWITCH_115: boolean; SWITCH_116: boolean; SWITCH_117: boolean; SWITCH_118: boolean; SWITCH_119: boolean; SWITCH_120: boolean; SWITCH_121: boolean; SWITCH_122: boolean; SWITCH_123: boolean; SWITCH_124: boolean; SWITCH_125: boolean; SWITCH_126: boolean; SWITCH_127: boolean; SWITCH_128: boolean; SWITCH_129: boolean; SWITCH_130: boolean; SWITCH_131: boolean; SWITCH_132: boolean; SWITCH_133: boolean; SWITCH_134: boolean; SWITCH_135: boolean; SWITCH_136: boolean; SWITCH_137: boolean; SWITCH_138: boolean; SWITCH_139: boolean; SWITCH_140: boolean; SWITCH_141: boolean; SWITCH_142: boolean; SWITCH_143: boolean; SWITCH_144: boolean; SWITCH_145: boolean; SWITCH_146: boolean; SWITCH_147: boolean; SWITCH_148: boolean; SWITCH_149: boolean; SWITCH_150: boolean; SWITCH_151: boolean; SWITCH_152: boolean; SWITCH_153: boolean; SWITCH_154: boolean; SWITCH_155: boolean; SWITCH_156: boolean; SWITCH_157: boolean; SWITCH_158: boolean; SWITCH_159: boolean; SWITCH_160: boolean; SWITCH_161: boolean; SWITCH_162: boolean; SWITCH_163: boolean; SWITCH_164: boolean; SWITCH_165: boolean; SWITCH_166: boolean; SWITCH_167: boolean; SWITCH_168: boolean; SWITCH_169: boolean; SWITCH_170: boolean; SWITCH_171: boolean; SWITCH_172: boolean; SWITCH_173: boolean; SWITCH_174: boolean; SWITCH_175: boolean; SWITCH_176: boolean; SWITCH_177: boolean; SWITCH_178: boolean; SWITCH_179: boolean; SWITCH_180: boolean; SWITCH_181: boolean; SWITCH_182: boolean; SWITCH_183: boolean; SWITCH_184: boolean; SWITCH_185: boolean; SWITCH_186: boolean; SWITCH_187: boolean; SWITCH_188: boolean; SWITCH_189: boolean; SWITCH_190: boolean; SWITCH_191: boolean; SWITCH_192: boolean; SWITCH_193: boolean; SWITCH_194: boolean; SWITCH_195: boolean; SWITCH_196: boolean; SWITCH_197: boolean; SWITCH_198: boolean; SWITCH_199: boolean; SWITCH_200: boolean; SWITCH_201: boolean; SWITCH_202: boolean; SWITCH_203: boolean; SWITCH_204: boolean; SWITCH_205: boolean; SWITCH_206: boolean; SWITCH_207: boolean; SWITCH_208: boolean; SWITCH_209: boolean; SWITCH_210: boolean; SWITCH_211: boolean; SWITCH_212: boolean; SWITCH_213: boolean; SWITCH_214: boolean; SWITCH_215: boolean; SWITCH_216: boolean; SWITCH_217: boolean; SWITCH_218: boolean; SWITCH_219: boolean; SWITCH_220: boolean; SWITCH_221: boolean; SWITCH_222: boolean; SWITCH_223: boolean; SWITCH_224: boolean; SWITCH_225: boolean; SWITCH_226: boolean; SWITCH_227: boolean; SWITCH_228: boolean; SWITCH_229: boolean; SWITCH_230: boolean; SWITCH_231: boolean; SWITCH_232: boolean; SWITCH_233: boolean; SWITCH_234: boolean; SWITCH_235: boolean; SWITCH_236: boolean; SWITCH_237: boolean; SWITCH_238: boolean; SWITCH_239: boolean; SWITCH_240: boolean; SWITCH_241: boolean; SWITCH_242: boolean; SWITCH_243: boolean; SWITCH_244: boolean; SWITCH_245: boolean; SWITCH_246: boolean; SWITCH_247: boolean; SWITCH_248: boolean; SWITCH_249: boolean; SWITCH_250: boolean; SWITCH_251: boolean; SWITCH_252: boolean; SWITCH_253: boolean; SWITCH_254: boolean; SWITCH_255: boolean; SWITCH_256: boolean; SWITCH_257: boolean; SWITCH_258: boolean; SWITCH_259: boolean; SWITCH_260: boolean; SWITCH_261: boolean; SWITCH_262: boolean; SWITCH_263: boolean; SWITCH_264: boolean; SWITCH_265: boolean; SWITCH_266: boolean; SWITCH_267: boolean; SWITCH_268: boolean; SWITCH_269: boolean; SWITCH_270: boolean; SWITCH_271: boolean; SWITCH_272: boolean; SWITCH_273: boolean; SWITCH_274: boolean; SWITCH_275: boolean; SWITCH_276: boolean; SWITCH_277: boolean; SWITCH_278: boolean; SWITCH_279: boolean; SWITCH_280: boolean; SWITCH_281: boolean; SWITCH_282: boolean; SWITCH_283: boolean; SWITCH_284: boolean; SWITCH_285: boolean; SWITCH_286: boolean; SWITCH_287: boolean; SWITCH_288: boolean; SWITCH_289: boolean; SWITCH_290: boolean; SWITCH_291: boolean; SWITCH_292: boolean; SWITCH_293: boolean; SWITCH_294: boolean; SWITCH_295: boolean; SWITCH_296: boolean; SWITCH_297: boolean; SWITCH_298: boolean; SWITCH_299: boolean; SWITCH_300: boolean; SWITCH_301: boolean; SWITCH_302: boolean; SWITCH_303: boolean; SWITCH_304: boolean; SWITCH_305: boolean; SWITCH_306: boolean; SWITCH_307: boolean; SWITCH_308: boolean; SWITCH_309: boolean; SWITCH_310: boolean; SWITCH_311: boolean; SWITCH_312: boolean; SWITCH_313: boolean; SWITCH_314: boolean; SWITCH_315: boolean; SWITCH_316: boolean; SWITCH_317: boolean; SWITCH_318: boolean; SWITCH_319: boolean; SWITCH_320: boolean; SWITCH_321: boolean; SWITCH_322: boolean; SWITCH_323: boolean; SWITCH_324: boolean; SWITCH_325: boolean; SWITCH_326: boolean; SWITCH_327: boolean; SWITCH_328: boolean; SWITCH_329: boolean; SWITCH_330: boolean; SWITCH_331: boolean; SWITCH_332: boolean; SWITCH_333: boolean; SWITCH_334: boolean; SWITCH_335: boolean; SWITCH_336: boolean; SWITCH_337: boolean; SWITCH_338: boolean; SWITCH_339: boolean; SWITCH_340: boolean; SWITCH_341: boolean; SWITCH_342: boolean; SWITCH_343: boolean; SWITCH_344: boolean; SWITCH_345: boolean; SWITCH_346: boolean; SWITCH_347: boolean; SWITCH_348: boolean; SWITCH_349: boolean; SWITCH_350: boolean; SWITCH_351: boolean; SWITCH_352: boolean; SWITCH_353: boolean; SWITCH_354: boolean; SWITCH_355: boolean; SWITCH_356: boolean; SWITCH_357: boolean; SWITCH_358: boolean; SWITCH_359: boolean; SWITCH_360: boolean; SWITCH_361: boolean; SWITCH_362: boolean; SWITCH_363: boolean; SWITCH_364: boolean; SWITCH_365: boolean; SWITCH_366: boolean; SWITCH_367: boolean; SWITCH_368: boolean; SWITCH_369: boolean; SWITCH_370: boolean; SWITCH_371: boolean; SWITCH_372: boolean; SWITCH_373: boolean; SWITCH_374: boolean; SWITCH_375: boolean; SWITCH_376: boolean; SWITCH_377: boolean; SWITCH_378: boolean; SWITCH_379: boolean; SWITCH_380: boolean; SWITCH_381: boolean; SWITCH_382: boolean; SWITCH_383: boolean; SWITCH_384: boolean; SWITCH_385: boolean; SWITCH_386: boolean; SWITCH_387: boolean; SWITCH_388: boolean; SWITCH_389: boolean; SWITCH_390: boolean; SWITCH_391: boolean; SWITCH_392: boolean; SWITCH_393: boolean; SWITCH_394: boolean; SWITCH_395: boolean; SWITCH_396: boolean; SWITCH_397: boolean; SWITCH_398: boolean; SWITCH_399: boolean; SHLVL: number | undefined; NOT_THERE_4: number | undefined } & typeof runtime & { set(key: string, value: string): void; unset(key: string): void };
const settings = build(SHAPE, runtime) as Settings;
const other = build(OTHER_SHAPE, null) as { LANG: string; NOT_THERE_5: boolean };

function is0(): number { return settings.SWITCH_0 ? 1 : 0; }
function is3(): number { return settings.SWITCH_3 ? 1 : 0; }
function is6(): number { return settings.SWITCH_6 ? 1 : 0; }
function is9(): number { return settings.SWITCH_9 ? 1 : 0; }
function is12(): number { return settings.SWITCH_12 ? 1 : 0; }
function is15(): number { return settings.SWITCH_15 ? 1 : 0; }
function is18(): number { return settings.SWITCH_18 ? 1 : 0; }
function is21(): number { return settings.SWITCH_21 ? 1 : 0; }
function is24(): number { return settings.SWITCH_24 ? 1 : 0; }
function is27(): number { return settings.SWITCH_27 ? 1 : 0; }
function is30(): number { return settings.SWITCH_30 ? 1 : 0; }
function is33(): number { return settings.SWITCH_33 ? 1 : 0; }
function is36(): number { return settings.SWITCH_36 ? 1 : 0; }
function is39(): number { return settings.SWITCH_39 ? 1 : 0; }
function is42(): number { return settings.SWITCH_42 ? 1 : 0; }
function is45(): number { return settings.SWITCH_45 ? 1 : 0; }
function is48(): number { return settings.SWITCH_48 ? 1 : 0; }
function is51(): number { return settings.SWITCH_51 ? 1 : 0; }
function is54(): number { return settings.SWITCH_54 ? 1 : 0; }
function is57(): number { return settings.SWITCH_57 ? 1 : 0; }
function is60(): number { return settings.SWITCH_60 ? 1 : 0; }
function is63(): number { return settings.SWITCH_63 ? 1 : 0; }
function is66(): number { return settings.SWITCH_66 ? 1 : 0; }
function is69(): number { return settings.SWITCH_69 ? 1 : 0; }
function is72(): number { return settings.SWITCH_72 ? 1 : 0; }
function is75(): number { return settings.SWITCH_75 ? 1 : 0; }
function is78(): number { return settings.SWITCH_78 ? 1 : 0; }
function is81(): number { return settings.SWITCH_81 ? 1 : 0; }
function is84(): number { return settings.SWITCH_84 ? 1 : 0; }
function is87(): number { return settings.SWITCH_87 ? 1 : 0; }
function is90(): number { return settings.SWITCH_90 ? 1 : 0; }
function is93(): number { return settings.SWITCH_93 ? 1 : 0; }
function is96(): number { return settings.SWITCH_96 ? 1 : 0; }
function is99(): number { return settings.SWITCH_99 ? 1 : 0; }
function is102(): number { return settings.SWITCH_102 ? 1 : 0; }
function is105(): number { return settings.SWITCH_105 ? 1 : 0; }
function is108(): number { return settings.SWITCH_108 ? 1 : 0; }
function is111(): number { return settings.SWITCH_111 ? 1 : 0; }
function is114(): number { return settings.SWITCH_114 ? 1 : 0; }
function is117(): number { return settings.SWITCH_117 ? 1 : 0; }
function is120(): number { return settings.SWITCH_120 ? 1 : 0; }
function is123(): number { return settings.SWITCH_123 ? 1 : 0; }
function is126(): number { return settings.SWITCH_126 ? 1 : 0; }
function is129(): number { return settings.SWITCH_129 ? 1 : 0; }
function is132(): number { return settings.SWITCH_132 ? 1 : 0; }
function is135(): number { return settings.SWITCH_135 ? 1 : 0; }
function is138(): number { return settings.SWITCH_138 ? 1 : 0; }
function is141(): number { return settings.SWITCH_141 ? 1 : 0; }
function is144(): number { return settings.SWITCH_144 ? 1 : 0; }
function is147(): number { return settings.SWITCH_147 ? 1 : 0; }
function is150(): number { return settings.SWITCH_150 ? 1 : 0; }
function is153(): number { return settings.SWITCH_153 ? 1 : 0; }
function is156(): number { return settings.SWITCH_156 ? 1 : 0; }
function is159(): number { return settings.SWITCH_159 ? 1 : 0; }
function is162(): number { return settings.SWITCH_162 ? 1 : 0; }
function is165(): number { return settings.SWITCH_165 ? 1 : 0; }
function is168(): number { return settings.SWITCH_168 ? 1 : 0; }
function is171(): number { return settings.SWITCH_171 ? 1 : 0; }
function is174(): number { return settings.SWITCH_174 ? 1 : 0; }
function is177(): number { return settings.SWITCH_177 ? 1 : 0; }
function is180(): number { return settings.SWITCH_180 ? 1 : 0; }
function is183(): number { return settings.SWITCH_183 ? 1 : 0; }
function is186(): number { return settings.SWITCH_186 ? 1 : 0; }
function is189(): number { return settings.SWITCH_189 ? 1 : 0; }
function is192(): number { return settings.SWITCH_192 ? 1 : 0; }
function is195(): number { return settings.SWITCH_195 ? 1 : 0; }
function is198(): number { return settings.SWITCH_198 ? 1 : 0; }
function is201(): number { return settings.SWITCH_201 ? 1 : 0; }
function is204(): number { return settings.SWITCH_204 ? 1 : 0; }
function is207(): number { return settings.SWITCH_207 ? 1 : 0; }
function is210(): number { return settings.SWITCH_210 ? 1 : 0; }
function is213(): number { return settings.SWITCH_213 ? 1 : 0; }
function is216(): number { return settings.SWITCH_216 ? 1 : 0; }
function is219(): number { return settings.SWITCH_219 ? 1 : 0; }
function is222(): number { return settings.SWITCH_222 ? 1 : 0; }
function is225(): number { return settings.SWITCH_225 ? 1 : 0; }
function is228(): number { return settings.SWITCH_228 ? 1 : 0; }
function is231(): number { return settings.SWITCH_231 ? 1 : 0; }
function is234(): number { return settings.SWITCH_234 ? 1 : 0; }
function is237(): number { return settings.SWITCH_237 ? 1 : 0; }
function is240(): number { return settings.SWITCH_240 ? 1 : 0; }
function is243(): number { return settings.SWITCH_243 ? 1 : 0; }
function is246(): number { return settings.SWITCH_246 ? 1 : 0; }
function is249(): number { return settings.SWITCH_249 ? 1 : 0; }
function is252(): number { return settings.SWITCH_252 ? 1 : 0; }
function is255(): number { return settings.SWITCH_255 ? 1 : 0; }
function is258(): number { return settings.SWITCH_258 ? 1 : 0; }
function is261(): number { return settings.SWITCH_261 ? 1 : 0; }
function is264(): number { return settings.SWITCH_264 ? 1 : 0; }
function is267(): number { return settings.SWITCH_267 ? 1 : 0; }
function is270(): number { return settings.SWITCH_270 ? 1 : 0; }
function is273(): number { return settings.SWITCH_273 ? 1 : 0; }
function is276(): number { return settings.SWITCH_276 ? 1 : 0; }
function is279(): number { return settings.SWITCH_279 ? 1 : 0; }
function is282(): number { return settings.SWITCH_282 ? 1 : 0; }
function is285(): number { return settings.SWITCH_285 ? 1 : 0; }
function is288(): number { return settings.SWITCH_288 ? 1 : 0; }
function is291(): number { return settings.SWITCH_291 ? 1 : 0; }
function is294(): number { return settings.SWITCH_294 ? 1 : 0; }
function is297(): number { return settings.SWITCH_297 ? 1 : 0; }
function is300(): number { return settings.SWITCH_300 ? 1 : 0; }
function is303(): number { return settings.SWITCH_303 ? 1 : 0; }
function is306(): number { return settings.SWITCH_306 ? 1 : 0; }
function is309(): number { return settings.SWITCH_309 ? 1 : 0; }
function is312(): number { return settings.SWITCH_312 ? 1 : 0; }
function is315(): number { return settings.SWITCH_315 ? 1 : 0; }
function is318(): number { return settings.SWITCH_318 ? 1 : 0; }
function is321(): number { return settings.SWITCH_321 ? 1 : 0; }
function is324(): number { return settings.SWITCH_324 ? 1 : 0; }
function is327(): number { return settings.SWITCH_327 ? 1 : 0; }
function is330(): number { return settings.SWITCH_330 ? 1 : 0; }
function is333(): number { return settings.SWITCH_333 ? 1 : 0; }
function is336(): number { return settings.SWITCH_336 ? 1 : 0; }
function is339(): number { return settings.SWITCH_339 ? 1 : 0; }
function is342(): number { return settings.SWITCH_342 ? 1 : 0; }
function is345(): number { return settings.SWITCH_345 ? 1 : 0; }
function is348(): number { return settings.SWITCH_348 ? 1 : 0; }
function is351(): number { return settings.SWITCH_351 ? 1 : 0; }
function is354(): number { return settings.SWITCH_354 ? 1 : 0; }
function is357(): number { return settings.SWITCH_357 ? 1 : 0; }
function is360(): number { return settings.SWITCH_360 ? 1 : 0; }
function is363(): number { return settings.SWITCH_363 ? 1 : 0; }
function is366(): number { return settings.SWITCH_366 ? 1 : 0; }
function is369(): number { return settings.SWITCH_369 ? 1 : 0; }
function is372(): number { return settings.SWITCH_372 ? 1 : 0; }
function is375(): number { return settings.SWITCH_375 ? 1 : 0; }
function is378(): number { return settings.SWITCH_378 ? 1 : 0; }
function is381(): number { return settings.SWITCH_381 ? 1 : 0; }
function is384(): number { return settings.SWITCH_384 ? 1 : 0; }
function is387(): number { return settings.SWITCH_387 ? 1 : 0; }
function is390(): number { return settings.SWITCH_390 ? 1 : 0; }
function is393(): number { return settings.SWITCH_393 ? 1 : 0; }
function is396(): number { return settings.SWITCH_396 ? 1 : 0; }
function is399(): number { return settings.SWITCH_399 ? 1 : 0; }
function group0(): number { return is0() + is3() + is6() + is9() + is12() + is15() + is18() + is21() + is24() + is27() + is30() + is33() + is36() + is39() + is42() + is45() + is48() + is51() + is54() + is57() + is60() + is63() + is66() + is69() + is72() + is75() + is78() + is81() + is84() + is87() + is90() + is93() + is96() + is99() + is102() + is105() + is108() + is111() + is114() + is117() + is120() + is123() + is126() + is129() + is132() + is135() + is138() + is141() + is144() + is147(); }
function group1(): number { return is150() + is153() + is156() + is159() + is162() + is165() + is168() + is171() + is174() + is177() + is180() + is183() + is186() + is189() + is192() + is195() + is198() + is201() + is204() + is207() + is210() + is213() + is216() + is219() + is222() + is225() + is228() + is231() + is234() + is237() + is240() + is243() + is246() + is249() + is252() + is255() + is258() + is261() + is264() + is267() + is270() + is273() + is276() + is279() + is282() + is285() + is288() + is291() + is294() + is297(); }
function group2(): number { return is300() + is303() + is306() + is309() + is312() + is315() + is318() + is321() + is324() + is327() + is330() + is333() + is336() + is339() + is342() + is345() + is348() + is351() + is354() + is357() + is360() + is363() + is366() + is369() + is372() + is375() + is378() + is381() + is384() + is387() + is390() + is393() + is396() + is399(); }
const rounds = Number(process.argv[2] ?? 1) | 0;
let seen = 0;
for (let r = 0; r < rounds; r++) seen += group0() + group1() + group2();
const keys = Object.keys(settings);
console.log(seen, rounds, keys.length, keys[0], keys[7], keys[keys.length - 1], keys.slice(10, 16).join());

// GENERATED: getterFor lazyAccessor has value
// CHECK-LABEL: function {{*}}name="getterFor"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|object site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[f_5]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[L_2]], v2: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = NewObject layout=[[L_7]]
// CHECK-NEXT: PutEnvironmentField v3, v2 layout=[[L_7]]
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: PutEnvironmentField v3, v5 layout=[[L_7]] field=1
// CHECK-NEXT: v7 = NewClosure v3, v0, v1 function=[[f_8]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_5]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="lazyAccessor"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|object site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|object site=[[w_10]] flags=[OmitsUndefined]}] results=[{type=undefined|null|object site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = NewObject layout=[[L_12]]
// CHECK-NEXT: v3 = Builtin builtin=Proxy
// CHECK-NEXT: v4 = Builtin builtin=Object
// CHECK-NEXT: v5 = Builtin builtin=ObjectCreate
// CHECK-NEXT: v6 = Call v5, v4, v1 calleeName="Object.create"
// CHECK-NEXT: v7 = NewClosure v2, v0 function=[[f_13]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_14]] flags=[IsExpected]}
// CHECK-NEXT: v9 = NewObject layout=[[L_15]]
// CHECK-NEXT: PropDefine v9, v8 key="get"
// CHECK-NEXT: v11 = NewClosure v0 function=[[f_16]]
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[f_17]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v9, v12 key="has"
// CHECK-NEXT: v14 = FinishObject v9
// CHECK-NEXT: v15 = Construct v3, -, v6, v14 calleeName="Proxy"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v17 = Builtin builtin=Object
// CHECK-NEXT: v18 = Builtin builtin=ObjectCreate
// CHECK-NEXT: v19 = Call v18, v17, v16 calleeName="Object.create"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|object site=[[w_18]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: PutEnvironmentField v2, v21 layout=[[L_12]]
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="has"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 captures=[{type=undefined|null|object site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|string|symbol site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=boolean site=[[w_20]]}] functionTypes={{*}}[[f_21]]] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: anything, v2: undefined|null|string|symbol):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_22]]
// CHECK-NEXT: v4 = Call v3, -, v0, v2 calleeName="isShapeKey"
// CHECK-NEXT: v5 = Convert v4 declared={type=boolean site=[[w_23]]}
// CHECK-NEXT: v6 = ToBoolean v5
// CHECK-NEXT: Branch v6 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v8 = Convert v7 declared={type=boolean site=[[w_20]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v10 = Builtin builtin=Reflect
// CHECK-NEXT: v11 = Builtin builtin=ReflectHas
// CHECK-NEXT: v12 = Convert v1 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v13 = Convert v2 declared={type=undefined|null|symbol} illTypedCause=Assertion
// CHECK-NEXT: v14 = Call v11, v10, v12, v13 calleeName="Reflect.has"
// CHECK-NEXT: ReturnCall v14 casts=[{declared={type=boolean site=[[w_24]]}}, {declared={type=boolean site=[[w_20]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="value"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_25]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|boolean|number|string site=[[w_26]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|boolean|number|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=Process
// CHECK-NEXT: v3 = PropGet v2 key="env"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ProcessEnv) flags=[IsExpected]}
// CHECK-NEXT: v5 = Builtin builtin=String
// CHECK-NEXT: v6 = Call v5, -, v1 calleeName="String"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string site=[[w_27]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: ElemSet v4, v0, v7
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="value"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_28]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Process
// CHECK-NEXT: v2 = PropGet v1 key="env"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(ProcessEnv) flags=[IsExpected]}
// CHECK-NEXT: v4 = ElemDelete v3, v0
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
