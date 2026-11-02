// What tsc emits for `enum State` into a published .js file, and a tokenizer that switches on it: `case State.S37:` (parse5, saxes, many parsers).
var State;
(function (State) {
  State[(State["S0"] = 0)] = "S0";
  State[(State["S1"] = 1)] = "S1";
  State[(State["S2"] = 2)] = "S2";
  State[(State["S3"] = 3)] = "S3";
  State[(State["S4"] = 4)] = "S4";
  State[(State["S5"] = 5)] = "S5";
  State[(State["S6"] = 6)] = "S6";
  State[(State["S7"] = 7)] = "S7";
  State[(State["S8"] = 8)] = "S8";
  State[(State["S9"] = 9)] = "S9";
  State[(State["S10"] = 10)] = "S10";
  State[(State["S11"] = 11)] = "S11";
  State[(State["S12"] = 12)] = "S12";
  State[(State["S13"] = 13)] = "S13";
  State[(State["S14"] = 14)] = "S14";
  State[(State["S15"] = 15)] = "S15";
  State[(State["S16"] = 16)] = "S16";
  State[(State["S17"] = 17)] = "S17";
  State[(State["S18"] = 18)] = "S18";
  State[(State["S19"] = 19)] = "S19";
  State[(State["S20"] = 20)] = "S20";
  State[(State["S21"] = 21)] = "S21";
  State[(State["S22"] = 22)] = "S22";
  State[(State["S23"] = 23)] = "S23";
  State[(State["S24"] = 24)] = "S24";
  State[(State["S25"] = 25)] = "S25";
  State[(State["S26"] = 26)] = "S26";
  State[(State["S27"] = 27)] = "S27";
  State[(State["S28"] = 28)] = "S28";
  State[(State["S29"] = 29)] = "S29";
  State[(State["S30"] = 30)] = "S30";
  State[(State["S31"] = 31)] = "S31";
  State[(State["S32"] = 32)] = "S32";
  State[(State["S33"] = 33)] = "S33";
  State[(State["S34"] = 34)] = "S34";
  State[(State["S35"] = 35)] = "S35";
  State[(State["S36"] = 36)] = "S36";
  State[(State["S37"] = 37)] = "S37";
  State[(State["S38"] = 38)] = "S38";
  State[(State["S39"] = 39)] = "S39";
  State[(State["S40"] = 40)] = "S40";
  State[(State["S41"] = 41)] = "S41";
  State[(State["S42"] = 42)] = "S42";
  State[(State["S43"] = 43)] = "S43";
  State[(State["S44"] = 44)] = "S44";
  State[(State["S45"] = 45)] = "S45";
  State[(State["S46"] = 46)] = "S46";
  State[(State["S47"] = 47)] = "S47";
  State[(State["S48"] = 48)] = "S48";
  State[(State["S49"] = 49)] = "S49";
  State[(State["S50"] = 50)] = "S50";
  State[(State["S51"] = 51)] = "S51";
  State[(State["S52"] = 52)] = "S52";
  State[(State["S53"] = 53)] = "S53";
  State[(State["S54"] = 54)] = "S54";
  State[(State["S55"] = 55)] = "S55";
  State[(State["S56"] = 56)] = "S56";
  State[(State["S57"] = 57)] = "S57";
  State[(State["S58"] = 58)] = "S58";
  State[(State["S59"] = 59)] = "S59";
  State[(State["S60"] = 60)] = "S60";
  State[(State["S61"] = 61)] = "S61";
  State[(State["S62"] = 62)] = "S62";
  State[(State["S63"] = 63)] = "S63";
})(State || (State = {}));
class Tokenizer {
  constructor() {
    this.state = State.S0;
    this.count = 0;
  }
  step(c) {
    switch (this.state) {
      case State.S0: {
        this.count += 0;
        this.state = c & 1 ? State.S1 : State.S1;
        break;
      }
      case State.S1: {
        this.count += 1;
        this.state = c & 1 ? State.S8 : State.S2;
        break;
      }
      case State.S2: {
        this.count += 2;
        this.state = c & 1 ? State.S15 : State.S3;
        break;
      }
      case State.S3: {
        this.count += 3;
        this.state = c & 1 ? State.S22 : State.S4;
        break;
      }
      case State.S4: {
        this.count += 0;
        this.state = c & 1 ? State.S29 : State.S5;
        break;
      }
      case State.S5: {
        this.count += 1;
        this.state = c & 1 ? State.S36 : State.S6;
        break;
      }
      case State.S6: {
        this.count += 2;
        this.state = c & 1 ? State.S43 : State.S7;
        break;
      }
      case State.S7: {
        this.count += 3;
        this.state = c & 1 ? State.S50 : State.S8;
        break;
      }
      case State.S8: {
        this.count += 0;
        this.state = c & 1 ? State.S57 : State.S9;
        break;
      }
      case State.S9: {
        this.count += 1;
        this.state = c & 1 ? State.S0 : State.S10;
        break;
      }
      case State.S10: {
        this.count += 2;
        this.state = c & 1 ? State.S7 : State.S11;
        break;
      }
      case State.S11: {
        this.count += 3;
        this.state = c & 1 ? State.S14 : State.S12;
        break;
      }
      case State.S12: {
        this.count += 0;
        this.state = c & 1 ? State.S21 : State.S13;
        break;
      }
      case State.S13: {
        this.count += 1;
        this.state = c & 1 ? State.S28 : State.S14;
        break;
      }
      case State.S14: {
        this.count += 2;
        this.state = c & 1 ? State.S35 : State.S15;
        break;
      }
      case State.S15: {
        this.count += 3;
        this.state = c & 1 ? State.S42 : State.S16;
        break;
      }
      case State.S16: {
        this.count += 0;
        this.state = c & 1 ? State.S49 : State.S17;
        break;
      }
      case State.S17: {
        this.count += 1;
        this.state = c & 1 ? State.S56 : State.S18;
        break;
      }
      case State.S18: {
        this.count += 2;
        this.state = c & 1 ? State.S63 : State.S19;
        break;
      }
      case State.S19: {
        this.count += 3;
        this.state = c & 1 ? State.S6 : State.S20;
        break;
      }
      case State.S20: {
        this.count += 0;
        this.state = c & 1 ? State.S13 : State.S21;
        break;
      }
      case State.S21: {
        this.count += 1;
        this.state = c & 1 ? State.S20 : State.S22;
        break;
      }
      case State.S22: {
        this.count += 2;
        this.state = c & 1 ? State.S27 : State.S23;
        break;
      }
      case State.S23: {
        this.count += 3;
        this.state = c & 1 ? State.S34 : State.S24;
        break;
      }
      case State.S24: {
        this.count += 0;
        this.state = c & 1 ? State.S41 : State.S25;
        break;
      }
      case State.S25: {
        this.count += 1;
        this.state = c & 1 ? State.S48 : State.S26;
        break;
      }
      case State.S26: {
        this.count += 2;
        this.state = c & 1 ? State.S55 : State.S27;
        break;
      }
      case State.S27: {
        this.count += 3;
        this.state = c & 1 ? State.S62 : State.S28;
        break;
      }
      case State.S28: {
        this.count += 0;
        this.state = c & 1 ? State.S5 : State.S29;
        break;
      }
      case State.S29: {
        this.count += 1;
        this.state = c & 1 ? State.S12 : State.S30;
        break;
      }
      case State.S30: {
        this.count += 2;
        this.state = c & 1 ? State.S19 : State.S31;
        break;
      }
      case State.S31: {
        this.count += 3;
        this.state = c & 1 ? State.S26 : State.S32;
        break;
      }
      case State.S32: {
        this.count += 0;
        this.state = c & 1 ? State.S33 : State.S33;
        break;
      }
      case State.S33: {
        this.count += 1;
        this.state = c & 1 ? State.S40 : State.S34;
        break;
      }
      case State.S34: {
        this.count += 2;
        this.state = c & 1 ? State.S47 : State.S35;
        break;
      }
      case State.S35: {
        this.count += 3;
        this.state = c & 1 ? State.S54 : State.S36;
        break;
      }
      case State.S36: {
        this.count += 0;
        this.state = c & 1 ? State.S61 : State.S37;
        break;
      }
      case State.S37: {
        this.count += 1;
        this.state = c & 1 ? State.S4 : State.S38;
        break;
      }
      case State.S38: {
        this.count += 2;
        this.state = c & 1 ? State.S11 : State.S39;
        break;
      }
      case State.S39: {
        this.count += 3;
        this.state = c & 1 ? State.S18 : State.S40;
        break;
      }
      case State.S40: {
        this.count += 0;
        this.state = c & 1 ? State.S25 : State.S41;
        break;
      }
      case State.S41: {
        this.count += 1;
        this.state = c & 1 ? State.S32 : State.S42;
        break;
      }
      case State.S42: {
        this.count += 2;
        this.state = c & 1 ? State.S39 : State.S43;
        break;
      }
      case State.S43: {
        this.count += 3;
        this.state = c & 1 ? State.S46 : State.S44;
        break;
      }
      case State.S44: {
        this.count += 0;
        this.state = c & 1 ? State.S53 : State.S45;
        break;
      }
      case State.S45: {
        this.count += 1;
        this.state = c & 1 ? State.S60 : State.S46;
        break;
      }
      case State.S46: {
        this.count += 2;
        this.state = c & 1 ? State.S3 : State.S47;
        break;
      }
      case State.S47: {
        this.count += 3;
        this.state = c & 1 ? State.S10 : State.S48;
        break;
      }
      case State.S48: {
        this.count += 0;
        this.state = c & 1 ? State.S17 : State.S49;
        break;
      }
      case State.S49: {
        this.count += 1;
        this.state = c & 1 ? State.S24 : State.S50;
        break;
      }
      case State.S50: {
        this.count += 2;
        this.state = c & 1 ? State.S31 : State.S51;
        break;
      }
      case State.S51: {
        this.count += 3;
        this.state = c & 1 ? State.S38 : State.S52;
        break;
      }
      case State.S52: {
        this.count += 0;
        this.state = c & 1 ? State.S45 : State.S53;
        break;
      }
      case State.S53: {
        this.count += 1;
        this.state = c & 1 ? State.S52 : State.S54;
        break;
      }
      case State.S54: {
        this.count += 2;
        this.state = c & 1 ? State.S59 : State.S55;
        break;
      }
      case State.S55: {
        this.count += 3;
        this.state = c & 1 ? State.S2 : State.S56;
        break;
      }
      case State.S56: {
        this.count += 0;
        this.state = c & 1 ? State.S9 : State.S57;
        break;
      }
      case State.S57: {
        this.count += 1;
        this.state = c & 1 ? State.S16 : State.S58;
        break;
      }
      case State.S58: {
        this.count += 2;
        this.state = c & 1 ? State.S23 : State.S59;
        break;
      }
      case State.S59: {
        this.count += 3;
        this.state = c & 1 ? State.S30 : State.S60;
        break;
      }
      case State.S60: {
        this.count += 0;
        this.state = c & 1 ? State.S37 : State.S61;
        break;
      }
      case State.S61: {
        this.count += 1;
        this.state = c & 1 ? State.S44 : State.S62;
        break;
      }
      case State.S62: {
        this.count += 2;
        this.state = c & 1 ? State.S51 : State.S63;
        break;
      }
      case State.S63: {
        this.count += 3;
        this.state = c & 1 ? State.S58 : State.S0;
        break;
      }
      default:
        throw new Error("unknown state");
    }
  }
}
const t = new Tokenizer();
for (let i = 0; i < 100_000; i++) t.step((i * 2654435761) >>> 7);
console.log(t.count, t.state, State[t.state]);
