// Classes with 128, 129 and 130 static fields: more than an object has before it keeps its names in a table of its own.
// Each class is listed, described and read; most are changed before the first listing, or behind it.
function brief(keys) {
  let hash = 0;
  for (const key of keys) for (const unit of String(key)) hash = (hash * 31 + unit.charCodeAt(0)) | 0;
  return keys.length + " " + keys.slice(0, 4).map(String).join() + " .. " + keys.slice(-4).map(String).join() + " " + (hash >>> 0).toString(36);
}
function describe(made, key) {
  const found = Object.getOwnPropertyDescriptor(made, key);
  if (!found) return key + " none";
  const held = "value" in found ? JSON.stringify(found.value) : typeof found.get + " " + typeof found.set;
  return key + " " + held + " " + (found.writable ? "w" : "-") + (found.enumerable ? "e" : "-") + (found.configurable ? "c" : "-");
}
function attempt(run) {
  try {
    return JSON.stringify(run());
  } catch (error) {
    return error.constructor.name;
  }
}
function list(label, made) {
  const walked = [];
  for (const key in made) walked.push(key);
  console.log(label, "own keys", brief(Reflect.ownKeys(made)));
  console.log(label, "keys", brief(Object.keys(made)), "|", brief(walked), "|", brief(Object.keys({ ...made })));
  console.log(label, "entries", brief(Object.entries(made).map(([key, held]) => key + JSON.stringify(held))));
  console.log(label, ["f0", "f64", "f127", "f128", "f129", "f130", "name", "length", "added"].map(key => describe(made, key)).join(", "));
  console.log(label, JSON.stringify([made.f0, made.f64, made.f127, made.f128, made.f129, made.f130]), "f64" in made, Object.hasOwn(made, "f128"));
}

class Listed128 {
  static f0 = 0; static f1 = "s1"; static f2 = { v: 2 }; static f3 = 3; static f4 = "s4"; static f5 = { v: 5 }; static f6 = 6; static f7 = "s7";
  static f8 = { v: 8 }; static f9 = 9; static f10 = "s10"; static f11 = { v: 11 }; static f12 = 12; static f13 = "s13"; static f14 = { v: 14 }; static f15 = 15;
  static f16 = "s16"; static f17 = { v: 17 }; static f18 = 18; static f19 = "s19"; static f20 = { v: 20 }; static f21 = 21; static f22 = "s22"; static f23 = { v: 23 };
  static f24 = 24; static f25 = "s25"; static f26 = { v: 26 }; static f27 = 27; static f28 = "s28"; static f29 = { v: 29 }; static f30 = 30; static f31 = "s31";
  static f32 = { v: 32 }; static f33 = 33; static f34 = "s34"; static f35 = { v: 35 }; static f36 = 36; static f37 = "s37"; static f38 = { v: 38 }; static f39 = 39;
  static f40 = "s40"; static f41 = { v: 41 }; static f42 = 42; static f43 = "s43"; static f44 = { v: 44 }; static f45 = 45; static f46 = "s46"; static f47 = { v: 47 };
  static f48 = 48; static f49 = "s49"; static f50 = { v: 50 }; static f51 = 51; static f52 = "s52"; static f53 = { v: 53 }; static f54 = 54; static f55 = "s55";
  static f56 = { v: 56 }; static f57 = 57; static f58 = "s58"; static f59 = { v: 59 }; static f60 = 60; static f61 = "s61"; static f62 = { v: 62 }; static f63 = 63;
  static f64 = "s64"; static f65 = { v: 65 }; static f66 = 66; static f67 = "s67"; static f68 = { v: 68 }; static f69 = 69; static f70 = "s70"; static f71 = { v: 71 };
  static f72 = 72; static f73 = "s73"; static f74 = { v: 74 }; static f75 = 75; static f76 = "s76"; static f77 = { v: 77 }; static f78 = 78; static f79 = "s79";
  static f80 = { v: 80 }; static f81 = 81; static f82 = "s82"; static f83 = { v: 83 }; static f84 = 84; static f85 = "s85"; static f86 = { v: 86 }; static f87 = 87;
  static f88 = "s88"; static f89 = { v: 89 }; static f90 = 90; static f91 = "s91"; static f92 = { v: 92 }; static f93 = 93; static f94 = "s94"; static f95 = { v: 95 };
  static f96 = 96; static f97 = "s97"; static f98 = { v: 98 }; static f99 = 99; static f100 = "s100"; static f101 = { v: 101 }; static f102 = 102; static f103 = "s103";
  static f104 = { v: 104 }; static f105 = 105; static f106 = "s106"; static f107 = { v: 107 }; static f108 = 108; static f109 = "s109"; static f110 = { v: 110 }; static f111 = 111;
  static f112 = "s112"; static f113 = { v: 113 }; static f114 = 114; static f115 = "s115"; static f116 = { v: 116 }; static f117 = 117; static f118 = "s118"; static f119 = { v: 119 };
  static f120 = 120; static f121 = "s121"; static f122 = { v: 122 }; static f123 = 123; static f124 = "s124"; static f125 = { v: 125 }; static f126 = 126; static f127 = "s127";
}
list("128", Listed128);

class Listed129 {
  static f0 = 0; static f1 = "s1"; static f2 = { v: 2 }; static f3 = 3; static f4 = "s4"; static f5 = { v: 5 }; static f6 = 6; static f7 = "s7";
  static f8 = { v: 8 }; static f9 = 9; static f10 = "s10"; static f11 = { v: 11 }; static f12 = 12; static f13 = "s13"; static f14 = { v: 14 }; static f15 = 15;
  static f16 = "s16"; static f17 = { v: 17 }; static f18 = 18; static f19 = "s19"; static f20 = { v: 20 }; static f21 = 21; static f22 = "s22"; static f23 = { v: 23 };
  static f24 = 24; static f25 = "s25"; static f26 = { v: 26 }; static f27 = 27; static f28 = "s28"; static f29 = { v: 29 }; static f30 = 30; static f31 = "s31";
  static f32 = { v: 32 }; static f33 = 33; static f34 = "s34"; static f35 = { v: 35 }; static f36 = 36; static f37 = "s37"; static f38 = { v: 38 }; static f39 = 39;
  static f40 = "s40"; static f41 = { v: 41 }; static f42 = 42; static f43 = "s43"; static f44 = { v: 44 }; static f45 = 45; static f46 = "s46"; static f47 = { v: 47 };
  static f48 = 48; static f49 = "s49"; static f50 = { v: 50 }; static f51 = 51; static f52 = "s52"; static f53 = { v: 53 }; static f54 = 54; static f55 = "s55";
  static f56 = { v: 56 }; static f57 = 57; static f58 = "s58"; static f59 = { v: 59 }; static f60 = 60; static f61 = "s61"; static f62 = { v: 62 }; static f63 = 63;
  static f64 = "s64"; static f65 = { v: 65 }; static f66 = 66; static f67 = "s67"; static f68 = { v: 68 }; static f69 = 69; static f70 = "s70"; static f71 = { v: 71 };
  static f72 = 72; static f73 = "s73"; static f74 = { v: 74 }; static f75 = 75; static f76 = "s76"; static f77 = { v: 77 }; static f78 = 78; static f79 = "s79";
  static f80 = { v: 80 }; static f81 = 81; static f82 = "s82"; static f83 = { v: 83 }; static f84 = 84; static f85 = "s85"; static f86 = { v: 86 }; static f87 = 87;
  static f88 = "s88"; static f89 = { v: 89 }; static f90 = 90; static f91 = "s91"; static f92 = { v: 92 }; static f93 = 93; static f94 = "s94"; static f95 = { v: 95 };
  static f96 = 96; static f97 = "s97"; static f98 = { v: 98 }; static f99 = 99; static f100 = "s100"; static f101 = { v: 101 }; static f102 = 102; static f103 = "s103";
  static f104 = { v: 104 }; static f105 = 105; static f106 = "s106"; static f107 = { v: 107 }; static f108 = 108; static f109 = "s109"; static f110 = { v: 110 }; static f111 = 111;
  static f112 = "s112"; static f113 = { v: 113 }; static f114 = 114; static f115 = "s115"; static f116 = { v: 116 }; static f117 = 117; static f118 = "s118"; static f119 = { v: 119 };
  static f120 = 120; static f121 = "s121"; static f122 = { v: 122 }; static f123 = 123; static f124 = "s124"; static f125 = { v: 125 }; static f126 = 126; static f127 = "s127";
  static f128 = { v: 128 };
}
list("129", Listed129);

class Listed130 {
  static f0 = 0; static f1 = "s1"; static f2 = { v: 2 }; static f3 = 3; static f4 = "s4"; static f5 = { v: 5 }; static f6 = 6; static f7 = "s7";
  static f8 = { v: 8 }; static f9 = 9; static f10 = "s10"; static f11 = { v: 11 }; static f12 = 12; static f13 = "s13"; static f14 = { v: 14 }; static f15 = 15;
  static f16 = "s16"; static f17 = { v: 17 }; static f18 = 18; static f19 = "s19"; static f20 = { v: 20 }; static f21 = 21; static f22 = "s22"; static f23 = { v: 23 };
  static f24 = 24; static f25 = "s25"; static f26 = { v: 26 }; static f27 = 27; static f28 = "s28"; static f29 = { v: 29 }; static f30 = 30; static f31 = "s31";
  static f32 = { v: 32 }; static f33 = 33; static f34 = "s34"; static f35 = { v: 35 }; static f36 = 36; static f37 = "s37"; static f38 = { v: 38 }; static f39 = 39;
  static f40 = "s40"; static f41 = { v: 41 }; static f42 = 42; static f43 = "s43"; static f44 = { v: 44 }; static f45 = 45; static f46 = "s46"; static f47 = { v: 47 };
  static f48 = 48; static f49 = "s49"; static f50 = { v: 50 }; static f51 = 51; static f52 = "s52"; static f53 = { v: 53 }; static f54 = 54; static f55 = "s55";
  static f56 = { v: 56 }; static f57 = 57; static f58 = "s58"; static f59 = { v: 59 }; static f60 = 60; static f61 = "s61"; static f62 = { v: 62 }; static f63 = 63;
  static f64 = "s64"; static f65 = { v: 65 }; static f66 = 66; static f67 = "s67"; static f68 = { v: 68 }; static f69 = 69; static f70 = "s70"; static f71 = { v: 71 };
  static f72 = 72; static f73 = "s73"; static f74 = { v: 74 }; static f75 = 75; static f76 = "s76"; static f77 = { v: 77 }; static f78 = 78; static f79 = "s79";
  static f80 = { v: 80 }; static f81 = 81; static f82 = "s82"; static f83 = { v: 83 }; static f84 = 84; static f85 = "s85"; static f86 = { v: 86 }; static f87 = 87;
  static f88 = "s88"; static f89 = { v: 89 }; static f90 = 90; static f91 = "s91"; static f92 = { v: 92 }; static f93 = 93; static f94 = "s94"; static f95 = { v: 95 };
  static f96 = 96; static f97 = "s97"; static f98 = { v: 98 }; static f99 = 99; static f100 = "s100"; static f101 = { v: 101 }; static f102 = 102; static f103 = "s103";
  static f104 = { v: 104 }; static f105 = 105; static f106 = "s106"; static f107 = { v: 107 }; static f108 = 108; static f109 = "s109"; static f110 = { v: 110 }; static f111 = 111;
  static f112 = "s112"; static f113 = { v: 113 }; static f114 = 114; static f115 = "s115"; static f116 = { v: 116 }; static f117 = 117; static f118 = "s118"; static f119 = { v: 119 };
  static f120 = 120; static f121 = "s121"; static f122 = { v: 122 }; static f123 = 123; static f124 = "s124"; static f125 = { v: 125 }; static f126 = 126; static f127 = "s127";
  static f128 = { v: 128 }; static f129 = 129;
}
list("130", Listed130);

class ReadFirst {
  static f0 = 0; static f1 = "s1"; static f2 = { v: 2 }; static f3 = 3; static f4 = "s4"; static f5 = { v: 5 }; static f6 = 6; static f7 = "s7";
  static f8 = { v: 8 }; static f9 = 9; static f10 = "s10"; static f11 = { v: 11 }; static f12 = 12; static f13 = "s13"; static f14 = { v: 14 }; static f15 = 15;
  static f16 = "s16"; static f17 = { v: 17 }; static f18 = 18; static f19 = "s19"; static f20 = { v: 20 }; static f21 = 21; static f22 = "s22"; static f23 = { v: 23 };
  static f24 = 24; static f25 = "s25"; static f26 = { v: 26 }; static f27 = 27; static f28 = "s28"; static f29 = { v: 29 }; static f30 = 30; static f31 = "s31";
  static f32 = { v: 32 }; static f33 = 33; static f34 = "s34"; static f35 = { v: 35 }; static f36 = 36; static f37 = "s37"; static f38 = { v: 38 }; static f39 = 39;
  static f40 = "s40"; static f41 = { v: 41 }; static f42 = 42; static f43 = "s43"; static f44 = { v: 44 }; static f45 = 45; static f46 = "s46"; static f47 = { v: 47 };
  static f48 = 48; static f49 = "s49"; static f50 = { v: 50 }; static f51 = 51; static f52 = "s52"; static f53 = { v: 53 }; static f54 = 54; static f55 = "s55";
  static f56 = { v: 56 }; static f57 = 57; static f58 = "s58"; static f59 = { v: 59 }; static f60 = 60; static f61 = "s61"; static f62 = { v: 62 }; static f63 = 63;
  static f64 = "s64"; static f65 = { v: 65 }; static f66 = 66; static f67 = "s67"; static f68 = { v: 68 }; static f69 = 69; static f70 = "s70"; static f71 = { v: 71 };
  static f72 = 72; static f73 = "s73"; static f74 = { v: 74 }; static f75 = 75; static f76 = "s76"; static f77 = { v: 77 }; static f78 = 78; static f79 = "s79";
  static f80 = { v: 80 }; static f81 = 81; static f82 = "s82"; static f83 = { v: 83 }; static f84 = 84; static f85 = "s85"; static f86 = { v: 86 }; static f87 = 87;
  static f88 = "s88"; static f89 = { v: 89 }; static f90 = 90; static f91 = "s91"; static f92 = { v: 92 }; static f93 = 93; static f94 = "s94"; static f95 = { v: 95 };
  static f96 = 96; static f97 = "s97"; static f98 = { v: 98 }; static f99 = 99; static f100 = "s100"; static f101 = { v: 101 }; static f102 = 102; static f103 = "s103";
  static f104 = { v: 104 }; static f105 = 105; static f106 = "s106"; static f107 = { v: 107 }; static f108 = 108; static f109 = "s109"; static f110 = { v: 110 }; static f111 = 111;
  static f112 = "s112"; static f113 = { v: 113 }; static f114 = 114; static f115 = "s115"; static f116 = { v: 116 }; static f117 = 117; static f118 = "s118"; static f119 = { v: 119 };
  static f120 = 120; static f121 = "s121"; static f122 = { v: 122 }; static f123 = 123; static f124 = "s124"; static f125 = { v: 125 }; static f126 = 126; static f127 = "s127";
  static f128 = { v: 128 }; static f129 = 129;
}
console.log(ReadFirst.f0, ReadFirst.f129, ReadFirst.f130);
list("read first", ReadFirst);

class Stored {
  static f0 = 0; static f1 = "s1"; static f2 = { v: 2 }; static f3 = 3; static f4 = "s4"; static f5 = { v: 5 }; static f6 = 6; static f7 = "s7";
  static f8 = { v: 8 }; static f9 = 9; static f10 = "s10"; static f11 = { v: 11 }; static f12 = 12; static f13 = "s13"; static f14 = { v: 14 }; static f15 = 15;
  static f16 = "s16"; static f17 = { v: 17 }; static f18 = 18; static f19 = "s19"; static f20 = { v: 20 }; static f21 = 21; static f22 = "s22"; static f23 = { v: 23 };
  static f24 = 24; static f25 = "s25"; static f26 = { v: 26 }; static f27 = 27; static f28 = "s28"; static f29 = { v: 29 }; static f30 = 30; static f31 = "s31";
  static f32 = { v: 32 }; static f33 = 33; static f34 = "s34"; static f35 = { v: 35 }; static f36 = 36; static f37 = "s37"; static f38 = { v: 38 }; static f39 = 39;
  static f40 = "s40"; static f41 = { v: 41 }; static f42 = 42; static f43 = "s43"; static f44 = { v: 44 }; static f45 = 45; static f46 = "s46"; static f47 = { v: 47 };
  static f48 = 48; static f49 = "s49"; static f50 = { v: 50 }; static f51 = 51; static f52 = "s52"; static f53 = { v: 53 }; static f54 = 54; static f55 = "s55";
  static f56 = { v: 56 }; static f57 = 57; static f58 = "s58"; static f59 = { v: 59 }; static f60 = 60; static f61 = "s61"; static f62 = { v: 62 }; static f63 = 63;
  static f64 = "s64"; static f65 = { v: 65 }; static f66 = 66; static f67 = "s67"; static f68 = { v: 68 }; static f69 = 69; static f70 = "s70"; static f71 = { v: 71 };
  static f72 = 72; static f73 = "s73"; static f74 = { v: 74 }; static f75 = 75; static f76 = "s76"; static f77 = { v: 77 }; static f78 = 78; static f79 = "s79";
  static f80 = { v: 80 }; static f81 = 81; static f82 = "s82"; static f83 = { v: 83 }; static f84 = 84; static f85 = "s85"; static f86 = { v: 86 }; static f87 = 87;
  static f88 = "s88"; static f89 = { v: 89 }; static f90 = 90; static f91 = "s91"; static f92 = { v: 92 }; static f93 = 93; static f94 = "s94"; static f95 = { v: 95 };
  static f96 = 96; static f97 = "s97"; static f98 = { v: 98 }; static f99 = 99; static f100 = "s100"; static f101 = { v: 101 }; static f102 = 102; static f103 = "s103";
  static f104 = { v: 104 }; static f105 = 105; static f106 = "s106"; static f107 = { v: 107 }; static f108 = 108; static f109 = "s109"; static f110 = { v: 110 }; static f111 = 111;
  static f112 = "s112"; static f113 = { v: 113 }; static f114 = 114; static f115 = "s115"; static f116 = { v: 116 }; static f117 = 117; static f118 = "s118"; static f119 = { v: 119 };
  static f120 = 120; static f121 = "s121"; static f122 = { v: 122 }; static f123 = 123; static f124 = "s124"; static f125 = { v: 125 }; static f126 = 126; static f127 = "s127";
  static f128 = { v: 128 }; static f129 = 129;
}
Stored.f0 = 0.5;
Stored.f64 = null;
Stored.f129 = "other";
list("stored to", Stored);
Stored.f128 = [1];
list("stored to again", Stored);

class Deleted {
  static f0 = 0; static f1 = "s1"; static f2 = { v: 2 }; static f3 = 3; static f4 = "s4"; static f5 = { v: 5 }; static f6 = 6; static f7 = "s7";
  static f8 = { v: 8 }; static f9 = 9; static f10 = "s10"; static f11 = { v: 11 }; static f12 = 12; static f13 = "s13"; static f14 = { v: 14 }; static f15 = 15;
  static f16 = "s16"; static f17 = { v: 17 }; static f18 = 18; static f19 = "s19"; static f20 = { v: 20 }; static f21 = 21; static f22 = "s22"; static f23 = { v: 23 };
  static f24 = 24; static f25 = "s25"; static f26 = { v: 26 }; static f27 = 27; static f28 = "s28"; static f29 = { v: 29 }; static f30 = 30; static f31 = "s31";
  static f32 = { v: 32 }; static f33 = 33; static f34 = "s34"; static f35 = { v: 35 }; static f36 = 36; static f37 = "s37"; static f38 = { v: 38 }; static f39 = 39;
  static f40 = "s40"; static f41 = { v: 41 }; static f42 = 42; static f43 = "s43"; static f44 = { v: 44 }; static f45 = 45; static f46 = "s46"; static f47 = { v: 47 };
  static f48 = 48; static f49 = "s49"; static f50 = { v: 50 }; static f51 = 51; static f52 = "s52"; static f53 = { v: 53 }; static f54 = 54; static f55 = "s55";
  static f56 = { v: 56 }; static f57 = 57; static f58 = "s58"; static f59 = { v: 59 }; static f60 = 60; static f61 = "s61"; static f62 = { v: 62 }; static f63 = 63;
  static f64 = "s64"; static f65 = { v: 65 }; static f66 = 66; static f67 = "s67"; static f68 = { v: 68 }; static f69 = 69; static f70 = "s70"; static f71 = { v: 71 };
  static f72 = 72; static f73 = "s73"; static f74 = { v: 74 }; static f75 = 75; static f76 = "s76"; static f77 = { v: 77 }; static f78 = 78; static f79 = "s79";
  static f80 = { v: 80 }; static f81 = 81; static f82 = "s82"; static f83 = { v: 83 }; static f84 = 84; static f85 = "s85"; static f86 = { v: 86 }; static f87 = 87;
  static f88 = "s88"; static f89 = { v: 89 }; static f90 = 90; static f91 = "s91"; static f92 = { v: 92 }; static f93 = 93; static f94 = "s94"; static f95 = { v: 95 };
  static f96 = 96; static f97 = "s97"; static f98 = { v: 98 }; static f99 = 99; static f100 = "s100"; static f101 = { v: 101 }; static f102 = 102; static f103 = "s103";
  static f104 = { v: 104 }; static f105 = 105; static f106 = "s106"; static f107 = { v: 107 }; static f108 = 108; static f109 = "s109"; static f110 = { v: 110 }; static f111 = 111;
  static f112 = "s112"; static f113 = { v: 113 }; static f114 = 114; static f115 = "s115"; static f116 = { v: 116 }; static f117 = 117; static f118 = "s118"; static f119 = { v: 119 };
  static f120 = 120; static f121 = "s121"; static f122 = { v: 122 }; static f123 = 123; static f124 = "s124"; static f125 = { v: 125 }; static f126 = 126; static f127 = "s127";
  static f128 = { v: 128 }; static f129 = 129;
}
console.log(delete Deleted.f0, delete Deleted.f64, delete Deleted.f129);
list("deleted", Deleted);
Deleted.f64 = "back";
console.log(delete Deleted.f128);
list("deleted again", Deleted);

class Defined {
  static f0 = 0; static f1 = "s1"; static f2 = { v: 2 }; static f3 = 3; static f4 = "s4"; static f5 = { v: 5 }; static f6 = 6; static f7 = "s7";
  static f8 = { v: 8 }; static f9 = 9; static f10 = "s10"; static f11 = { v: 11 }; static f12 = 12; static f13 = "s13"; static f14 = { v: 14 }; static f15 = 15;
  static f16 = "s16"; static f17 = { v: 17 }; static f18 = 18; static f19 = "s19"; static f20 = { v: 20 }; static f21 = 21; static f22 = "s22"; static f23 = { v: 23 };
  static f24 = 24; static f25 = "s25"; static f26 = { v: 26 }; static f27 = 27; static f28 = "s28"; static f29 = { v: 29 }; static f30 = 30; static f31 = "s31";
  static f32 = { v: 32 }; static f33 = 33; static f34 = "s34"; static f35 = { v: 35 }; static f36 = 36; static f37 = "s37"; static f38 = { v: 38 }; static f39 = 39;
  static f40 = "s40"; static f41 = { v: 41 }; static f42 = 42; static f43 = "s43"; static f44 = { v: 44 }; static f45 = 45; static f46 = "s46"; static f47 = { v: 47 };
  static f48 = 48; static f49 = "s49"; static f50 = { v: 50 }; static f51 = 51; static f52 = "s52"; static f53 = { v: 53 }; static f54 = 54; static f55 = "s55";
  static f56 = { v: 56 }; static f57 = 57; static f58 = "s58"; static f59 = { v: 59 }; static f60 = 60; static f61 = "s61"; static f62 = { v: 62 }; static f63 = 63;
  static f64 = "s64"; static f65 = { v: 65 }; static f66 = 66; static f67 = "s67"; static f68 = { v: 68 }; static f69 = 69; static f70 = "s70"; static f71 = { v: 71 };
  static f72 = 72; static f73 = "s73"; static f74 = { v: 74 }; static f75 = 75; static f76 = "s76"; static f77 = { v: 77 }; static f78 = 78; static f79 = "s79";
  static f80 = { v: 80 }; static f81 = 81; static f82 = "s82"; static f83 = { v: 83 }; static f84 = 84; static f85 = "s85"; static f86 = { v: 86 }; static f87 = 87;
  static f88 = "s88"; static f89 = { v: 89 }; static f90 = 90; static f91 = "s91"; static f92 = { v: 92 }; static f93 = 93; static f94 = "s94"; static f95 = { v: 95 };
  static f96 = 96; static f97 = "s97"; static f98 = { v: 98 }; static f99 = 99; static f100 = "s100"; static f101 = { v: 101 }; static f102 = 102; static f103 = "s103";
  static f104 = { v: 104 }; static f105 = 105; static f106 = "s106"; static f107 = { v: 107 }; static f108 = 108; static f109 = "s109"; static f110 = { v: 110 }; static f111 = 111;
  static f112 = "s112"; static f113 = { v: 113 }; static f114 = 114; static f115 = "s115"; static f116 = { v: 116 }; static f117 = 117; static f118 = "s118"; static f119 = { v: 119 };
  static f120 = 120; static f121 = "s121"; static f122 = { v: 122 }; static f123 = 123; static f124 = "s124"; static f125 = { v: 125 }; static f126 = 126; static f127 = "s127";
  static f128 = { v: 128 }; static f129 = 129;
}
Object.defineProperty(Defined, "f0", { value: 9, writable: false });
Object.defineProperty(Defined, "f64", { get: () => "got", enumerable: false, configurable: true });
Object.defineProperty(Defined, "f129", { enumerable: false });
list("defined", Defined);
Object.defineProperty(Defined, "f128", { get: () => "got", enumerable: true, configurable: false });
list("defined again", Defined);

class Added {
  static f0 = 0; static f1 = "s1"; static f2 = { v: 2 }; static f3 = 3; static f4 = "s4"; static f5 = { v: 5 }; static f6 = 6; static f7 = "s7";
  static f8 = { v: 8 }; static f9 = 9; static f10 = "s10"; static f11 = { v: 11 }; static f12 = 12; static f13 = "s13"; static f14 = { v: 14 }; static f15 = 15;
  static f16 = "s16"; static f17 = { v: 17 }; static f18 = 18; static f19 = "s19"; static f20 = { v: 20 }; static f21 = 21; static f22 = "s22"; static f23 = { v: 23 };
  static f24 = 24; static f25 = "s25"; static f26 = { v: 26 }; static f27 = 27; static f28 = "s28"; static f29 = { v: 29 }; static f30 = 30; static f31 = "s31";
  static f32 = { v: 32 }; static f33 = 33; static f34 = "s34"; static f35 = { v: 35 }; static f36 = 36; static f37 = "s37"; static f38 = { v: 38 }; static f39 = 39;
  static f40 = "s40"; static f41 = { v: 41 }; static f42 = 42; static f43 = "s43"; static f44 = { v: 44 }; static f45 = 45; static f46 = "s46"; static f47 = { v: 47 };
  static f48 = 48; static f49 = "s49"; static f50 = { v: 50 }; static f51 = 51; static f52 = "s52"; static f53 = { v: 53 }; static f54 = 54; static f55 = "s55";
  static f56 = { v: 56 }; static f57 = 57; static f58 = "s58"; static f59 = { v: 59 }; static f60 = 60; static f61 = "s61"; static f62 = { v: 62 }; static f63 = 63;
  static f64 = "s64"; static f65 = { v: 65 }; static f66 = 66; static f67 = "s67"; static f68 = { v: 68 }; static f69 = 69; static f70 = "s70"; static f71 = { v: 71 };
  static f72 = 72; static f73 = "s73"; static f74 = { v: 74 }; static f75 = 75; static f76 = "s76"; static f77 = { v: 77 }; static f78 = 78; static f79 = "s79";
  static f80 = { v: 80 }; static f81 = 81; static f82 = "s82"; static f83 = { v: 83 }; static f84 = 84; static f85 = "s85"; static f86 = { v: 86 }; static f87 = 87;
  static f88 = "s88"; static f89 = { v: 89 }; static f90 = 90; static f91 = "s91"; static f92 = { v: 92 }; static f93 = 93; static f94 = "s94"; static f95 = { v: 95 };
  static f96 = 96; static f97 = "s97"; static f98 = { v: 98 }; static f99 = 99; static f100 = "s100"; static f101 = { v: 101 }; static f102 = 102; static f103 = "s103";
  static f104 = { v: 104 }; static f105 = 105; static f106 = "s106"; static f107 = { v: 107 }; static f108 = 108; static f109 = "s109"; static f110 = { v: 110 }; static f111 = 111;
  static f112 = "s112"; static f113 = { v: 113 }; static f114 = 114; static f115 = "s115"; static f116 = { v: 116 }; static f117 = 117; static f118 = "s118"; static f119 = { v: 119 };
  static f120 = 120; static f121 = "s121"; static f122 = { v: 122 }; static f123 = 123; static f124 = "s124"; static f125 = { v: 125 }; static f126 = 126; static f127 = "s127";
  static f128 = { v: 128 }; static f129 = 129;
}
Added.added = 1;
Added[Symbol.for("added")] = 2;
Added[7] = 3;
list("added", Added);
Added.later = 4;
list("added again", Added);

class Named {
  static name = "N";
  static f0 = 0; static f1 = "s1"; static f2 = { v: 2 }; static f3 = 3; static f4 = "s4"; static f5 = { v: 5 }; static f6 = 6; static f7 = "s7";
  static f8 = { v: 8 }; static f9 = 9; static f10 = "s10"; static f11 = { v: 11 }; static f12 = 12; static f13 = "s13"; static f14 = { v: 14 }; static f15 = 15;
  static f16 = "s16"; static f17 = { v: 17 }; static f18 = 18; static f19 = "s19"; static f20 = { v: 20 }; static f21 = 21; static f22 = "s22"; static f23 = { v: 23 };
  static f24 = 24; static f25 = "s25"; static f26 = { v: 26 }; static f27 = 27; static f28 = "s28"; static f29 = { v: 29 }; static f30 = 30; static f31 = "s31";
  static f32 = { v: 32 }; static f33 = 33; static f34 = "s34"; static f35 = { v: 35 }; static f36 = 36; static f37 = "s37"; static f38 = { v: 38 }; static f39 = 39;
  static f40 = "s40"; static f41 = { v: 41 }; static f42 = 42; static f43 = "s43"; static f44 = { v: 44 }; static f45 = 45; static f46 = "s46"; static f47 = { v: 47 };
  static f48 = 48; static f49 = "s49"; static f50 = { v: 50 }; static f51 = 51; static f52 = "s52"; static f53 = { v: 53 }; static f54 = 54; static f55 = "s55";
  static f56 = { v: 56 }; static f57 = 57; static f58 = "s58"; static f59 = { v: 59 }; static f60 = 60; static f61 = "s61"; static f62 = { v: 62 }; static f63 = 63;
  static f64 = "s64"; static f65 = { v: 65 }; static f66 = 66; static f67 = "s67"; static f68 = { v: 68 }; static f69 = 69; static f70 = "s70"; static f71 = { v: 71 };
  static f72 = 72; static f73 = "s73"; static f74 = { v: 74 }; static f75 = 75; static f76 = "s76"; static f77 = { v: 77 }; static f78 = 78; static f79 = "s79";
  static f80 = { v: 80 }; static f81 = 81; static f82 = "s82"; static f83 = { v: 83 }; static f84 = 84; static f85 = "s85"; static f86 = { v: 86 }; static f87 = 87;
  static f88 = "s88"; static f89 = { v: 89 }; static f90 = 90; static f91 = "s91"; static f92 = { v: 92 }; static f93 = 93; static f94 = "s94"; static f95 = { v: 95 };
  static f96 = 96; static f97 = "s97"; static f98 = { v: 98 }; static f99 = 99; static f100 = "s100"; static f101 = { v: 101 }; static f102 = 102; static f103 = "s103";
  static f104 = { v: 104 }; static f105 = 105; static f106 = "s106"; static f107 = { v: 107 }; static f108 = 108; static f109 = "s109"; static f110 = { v: 110 }; static f111 = 111;
  static f112 = "s112"; static f113 = { v: 113 }; static f114 = 114; static f115 = "s115"; static f116 = { v: 116 }; static f117 = 117; static f118 = "s118"; static f119 = { v: 119 };
  static f120 = 120; static f121 = "s121"; static f122 = { v: 122 }; static f123 = 123; static f124 = "s124"; static f125 = { v: 125 }; static f126 = 126; static f127 = "s127";
  static length = 77;
}
list("named", Named);

/* eslint-disable no-dupe-class-members */
class Twice {
  static f129() {}
  static f0 = 0; static f1 = "s1"; static f2 = { v: 2 }; static f3 = 3; static f4 = "s4"; static f5 = { v: 5 }; static f6 = 6; static f7 = "s7";
  static f8 = { v: 8 }; static f9 = 9; static f10 = "s10"; static f11 = { v: 11 }; static f12 = 12; static f13 = "s13"; static f14 = { v: 14 }; static f15 = 15;
  static f16 = "s16"; static f17 = { v: 17 }; static f18 = 18; static f19 = "s19"; static f20 = { v: 20 }; static f21 = 21; static f22 = "s22"; static f23 = { v: 23 };
  static f24 = 24; static f25 = "s25"; static f26 = { v: 26 }; static f27 = 27; static f28 = "s28"; static f29 = { v: 29 }; static f30 = 30; static f31 = "s31";
  static f32 = { v: 32 }; static f33 = 33; static f34 = "s34"; static f35 = { v: 35 }; static f36 = 36; static f37 = "s37"; static f38 = { v: 38 }; static f39 = 39;
  static f40 = "s40"; static f41 = { v: 41 }; static f42 = 42; static f43 = "s43"; static f44 = { v: 44 }; static f45 = 45; static f46 = "s46"; static f47 = { v: 47 };
  static f48 = 48; static f49 = "s49"; static f50 = { v: 50 }; static f51 = 51; static f52 = "s52"; static f53 = { v: 53 }; static f54 = 54; static f55 = "s55";
  static f56 = { v: 56 }; static f57 = 57; static f58 = "s58"; static f59 = { v: 59 }; static f60 = 60; static f61 = "s61"; static f62 = { v: 62 }; static f63 = 63;
  static f64 = "s64"; static f65 = { v: 65 }; static f66 = 66; static f67 = "s67"; static f68 = { v: 68 }; static f69 = 69; static f70 = "s70"; static f71 = { v: 71 };
  static f72 = 72; static f73 = "s73"; static f74 = { v: 74 }; static f75 = 75; static f76 = "s76"; static f77 = { v: 77 }; static f78 = 78; static f79 = "s79";
  static f80 = { v: 80 }; static f81 = 81; static f82 = "s82"; static f83 = { v: 83 }; static f84 = 84; static f85 = "s85"; static f86 = { v: 86 }; static f87 = 87;
  static f88 = "s88"; static f89 = { v: 89 }; static f90 = 90; static f91 = "s91"; static f92 = { v: 92 }; static f93 = 93; static f94 = "s94"; static f95 = { v: 95 };
  static f96 = 96; static f97 = "s97"; static f98 = { v: 98 }; static f99 = 99; static f100 = "s100"; static f101 = { v: 101 }; static f102 = 102; static f103 = "s103";
  static f104 = { v: 104 }; static f105 = 105; static f106 = "s106"; static f107 = { v: 107 }; static f108 = 108; static f109 = "s109"; static f110 = { v: 110 }; static f111 = 111;
  static f112 = "s112"; static f113 = { v: 113 }; static f114 = 114; static f115 = "s115"; static f116 = { v: 116 }; static f117 = 117; static f118 = "s118"; static f119 = { v: 119 };
  static f120 = 120; static f121 = "s121"; static f122 = { v: 122 }; static f123 = 123; static f124 = "s124"; static f125 = { v: 125 }; static f126 = 126; static f127 = "s127";
  static f128 = { v: 128 }; static f129 = 129;
  static f0 = "again"; static ["f" + 64] = "again"; static get f130() { return "got"; }
}
/* eslint-enable no-dupe-class-members */
list("twice", Twice);

class Inside {
  static f0 = 0; static f1 = "s1"; static f2 = { v: 2 }; static f3 = 3; static f4 = "s4"; static f5 = { v: 5 }; static f6 = 6; static f7 = "s7";
  static f8 = { v: 8 }; static f9 = 9; static f10 = "s10"; static f11 = { v: 11 }; static f12 = 12; static f13 = "s13"; static f14 = { v: 14 }; static f15 = 15;
  static f16 = "s16"; static f17 = { v: 17 }; static f18 = 18; static f19 = "s19"; static f20 = { v: 20 }; static f21 = 21; static f22 = "s22"; static f23 = { v: 23 };
  static f24 = 24; static f25 = "s25"; static f26 = { v: 26 }; static f27 = 27; static f28 = "s28"; static f29 = { v: 29 }; static f30 = 30; static f31 = "s31";
  static f32 = { v: 32 }; static f33 = 33; static f34 = "s34"; static f35 = { v: 35 }; static f36 = 36; static f37 = "s37"; static f38 = { v: 38 }; static f39 = 39;
  static f40 = "s40"; static f41 = { v: 41 }; static f42 = 42; static f43 = "s43"; static f44 = { v: 44 }; static f45 = 45; static f46 = "s46"; static f47 = { v: 47 };
  static f48 = 48; static f49 = "s49"; static f50 = { v: 50 }; static f51 = 51; static f52 = "s52"; static f53 = { v: 53 }; static f54 = 54; static f55 = "s55";
  static f56 = { v: 56 }; static f57 = 57; static f58 = "s58"; static f59 = { v: 59 }; static f60 = 60; static f61 = "s61"; static f62 = { v: 62 }; static f63 = 63;
  static f64 = "s64";
  static { console.log("inside", brief(Reflect.ownKeys(this)), delete this.f0); this.added = 5; }
  static f65 = { v: 65 }; static f66 = 66; static f67 = "s67"; static f68 = { v: 68 }; static f69 = 69; static f70 = "s70"; static f71 = { v: 71 }; static f72 = 72;
  static f73 = "s73"; static f74 = { v: 74 }; static f75 = 75; static f76 = "s76"; static f77 = { v: 77 }; static f78 = 78; static f79 = "s79"; static f80 = { v: 80 };
  static f81 = 81; static f82 = "s82"; static f83 = { v: 83 }; static f84 = 84; static f85 = "s85"; static f86 = { v: 86 }; static f87 = 87; static f88 = "s88";
  static f89 = { v: 89 }; static f90 = 90; static f91 = "s91"; static f92 = { v: 92 }; static f93 = 93; static f94 = "s94"; static f95 = { v: 95 }; static f96 = 96;
  static f97 = "s97"; static f98 = { v: 98 }; static f99 = 99; static f100 = "s100"; static f101 = { v: 101 }; static f102 = 102; static f103 = "s103"; static f104 = { v: 104 };
  static f105 = 105; static f106 = "s106"; static f107 = { v: 107 }; static f108 = 108; static f109 = "s109"; static f110 = { v: 110 }; static f111 = 111; static f112 = "s112";
  static f113 = { v: 113 }; static f114 = 114; static f115 = "s115"; static f116 = { v: 116 }; static f117 = 117; static f118 = "s118"; static f119 = { v: 119 }; static f120 = 120;
  static f121 = "s121"; static f122 = { v: 122 }; static f123 = 123; static f124 = "s124"; static f125 = { v: 125 }; static f126 = 126; static f127 = "s127"; static f128 = { v: 128 };
  static { console.log("inside", brief(Reflect.ownKeys(this))); }
  static f129 = 129;
}
list("listed inside", Inside);

class Frozen {
  static f0 = 0; static f1 = "s1"; static f2 = { v: 2 }; static f3 = 3; static f4 = "s4"; static f5 = { v: 5 }; static f6 = 6; static f7 = "s7";
  static f8 = { v: 8 }; static f9 = 9; static f10 = "s10"; static f11 = { v: 11 }; static f12 = 12; static f13 = "s13"; static f14 = { v: 14 }; static f15 = 15;
  static f16 = "s16"; static f17 = { v: 17 }; static f18 = 18; static f19 = "s19"; static f20 = { v: 20 }; static f21 = 21; static f22 = "s22"; static f23 = { v: 23 };
  static f24 = 24; static f25 = "s25"; static f26 = { v: 26 }; static f27 = 27; static f28 = "s28"; static f29 = { v: 29 }; static f30 = 30; static f31 = "s31";
  static f32 = { v: 32 }; static f33 = 33; static f34 = "s34"; static f35 = { v: 35 }; static f36 = 36; static f37 = "s37"; static f38 = { v: 38 }; static f39 = 39;
  static f40 = "s40"; static f41 = { v: 41 }; static f42 = 42; static f43 = "s43"; static f44 = { v: 44 }; static f45 = 45; static f46 = "s46"; static f47 = { v: 47 };
  static f48 = 48; static f49 = "s49"; static f50 = { v: 50 }; static f51 = 51; static f52 = "s52"; static f53 = { v: 53 }; static f54 = 54; static f55 = "s55";
  static f56 = { v: 56 }; static f57 = 57; static f58 = "s58"; static f59 = { v: 59 }; static f60 = 60; static f61 = "s61"; static f62 = { v: 62 }; static f63 = 63;
  static f64 = "s64"; static f65 = { v: 65 }; static f66 = 66; static f67 = "s67"; static f68 = { v: 68 }; static f69 = 69; static f70 = "s70"; static f71 = { v: 71 };
  static f72 = 72; static f73 = "s73"; static f74 = { v: 74 }; static f75 = 75; static f76 = "s76"; static f77 = { v: 77 }; static f78 = 78; static f79 = "s79";
  static f80 = { v: 80 }; static f81 = 81; static f82 = "s82"; static f83 = { v: 83 }; static f84 = 84; static f85 = "s85"; static f86 = { v: 86 }; static f87 = 87;
  static f88 = "s88"; static f89 = { v: 89 }; static f90 = 90; static f91 = "s91"; static f92 = { v: 92 }; static f93 = 93; static f94 = "s94"; static f95 = { v: 95 };
  static f96 = 96; static f97 = "s97"; static f98 = { v: 98 }; static f99 = 99; static f100 = "s100"; static f101 = { v: 101 }; static f102 = 102; static f103 = "s103";
  static f104 = { v: 104 }; static f105 = 105; static f106 = "s106"; static f107 = { v: 107 }; static f108 = 108; static f109 = "s109"; static f110 = { v: 110 }; static f111 = 111;
  static f112 = "s112"; static f113 = { v: 113 }; static f114 = 114; static f115 = "s115"; static f116 = { v: 116 }; static f117 = 117; static f118 = "s118"; static f119 = { v: 119 };
  static f120 = 120; static f121 = "s121"; static f122 = { v: 122 }; static f123 = 123; static f124 = "s124"; static f125 = { v: 125 }; static f126 = 126; static f127 = "s127";
  static f128 = { v: 128 }; static f129 = 129;
}
Object.freeze(Frozen);
list("frozen", Frozen);
console.log(attempt(() => { "use strict"; Frozen.f64 = 1; }), attempt(() => { "use strict"; Frozen.added = 1; }), attempt(() => { "use strict"; delete Frozen.f129; }), Object.isFrozen(Frozen));

class Closed {
  static f0 = 0; static f1 = "s1"; static f2 = { v: 2 }; static f3 = 3; static f4 = "s4"; static f5 = { v: 5 }; static f6 = 6; static f7 = "s7";
  static f8 = { v: 8 }; static f9 = 9; static f10 = "s10"; static f11 = { v: 11 }; static f12 = 12; static f13 = "s13"; static f14 = { v: 14 }; static f15 = 15;
  static f16 = "s16"; static f17 = { v: 17 }; static f18 = 18; static f19 = "s19"; static f20 = { v: 20 }; static f21 = 21; static f22 = "s22"; static f23 = { v: 23 };
  static f24 = 24; static f25 = "s25"; static f26 = { v: 26 }; static f27 = 27; static f28 = "s28"; static f29 = { v: 29 }; static f30 = 30; static f31 = "s31";
  static f32 = { v: 32 }; static f33 = 33; static f34 = "s34"; static f35 = { v: 35 }; static f36 = 36; static f37 = "s37"; static f38 = { v: 38 }; static f39 = 39;
  static f40 = "s40"; static f41 = { v: 41 }; static f42 = 42; static f43 = "s43"; static f44 = { v: 44 }; static f45 = 45; static f46 = "s46"; static f47 = { v: 47 };
  static f48 = 48; static f49 = "s49"; static f50 = { v: 50 }; static f51 = 51; static f52 = "s52"; static f53 = { v: 53 }; static f54 = 54; static f55 = "s55";
  static f56 = { v: 56 }; static f57 = 57; static f58 = "s58"; static f59 = { v: 59 }; static f60 = 60; static f61 = "s61"; static f62 = { v: 62 }; static f63 = 63;
  static f64 = "s64"; static f65 = { v: 65 }; static f66 = 66; static f67 = "s67"; static f68 = { v: 68 }; static f69 = 69; static f70 = "s70"; static f71 = { v: 71 };
  static f72 = 72; static f73 = "s73"; static f74 = { v: 74 }; static f75 = 75; static f76 = "s76"; static f77 = { v: 77 }; static f78 = 78; static f79 = "s79";
  static f80 = { v: 80 }; static f81 = 81; static f82 = "s82"; static f83 = { v: 83 }; static f84 = 84; static f85 = "s85"; static f86 = { v: 86 }; static f87 = 87;
  static f88 = "s88"; static f89 = { v: 89 }; static f90 = 90; static f91 = "s91"; static f92 = { v: 92 }; static f93 = 93; static f94 = "s94"; static f95 = { v: 95 };
  static f96 = 96; static f97 = "s97"; static f98 = { v: 98 }; static f99 = 99; static f100 = "s100"; static f101 = { v: 101 }; static f102 = 102; static f103 = "s103";
  static f104 = { v: 104 }; static f105 = 105; static f106 = "s106"; static f107 = { v: 107 }; static f108 = 108; static f109 = "s109"; static f110 = { v: 110 }; static f111 = 111;
  static f112 = "s112"; static f113 = { v: 113 }; static f114 = 114; static f115 = "s115"; static f116 = { v: 116 }; static f117 = 117; static f118 = "s118"; static f119 = { v: 119 };
  static f120 = 120; static f121 = "s121"; static f122 = { v: 122 }; static f123 = 123; static f124 = "s124"; static f125 = { v: 125 }; static f126 = 126; static f127 = "s127";
  static f128 = { v: 128 }; static f129 = 129;
}
list("open", Closed);
Object.preventExtensions(Closed);
console.log(delete Closed.f64, attempt(() => { "use strict"; Closed.f64 = 1; }), Object.isSealed(Closed));
list("closed", Closed);

class Above {
  static f0 = 0; static f1 = "s1"; static f2 = { v: 2 }; static f3 = 3; static f4 = "s4"; static f5 = { v: 5 }; static f6 = 6; static f7 = "s7";
  static f8 = { v: 8 }; static f9 = 9; static f10 = "s10"; static f11 = { v: 11 }; static f12 = 12; static f13 = "s13"; static f14 = { v: 14 }; static f15 = 15;
  static f16 = "s16"; static f17 = { v: 17 }; static f18 = 18; static f19 = "s19"; static f20 = { v: 20 }; static f21 = 21; static f22 = "s22"; static f23 = { v: 23 };
  static f24 = 24; static f25 = "s25"; static f26 = { v: 26 }; static f27 = 27; static f28 = "s28"; static f29 = { v: 29 }; static f30 = 30; static f31 = "s31";
  static f32 = { v: 32 }; static f33 = 33; static f34 = "s34"; static f35 = { v: 35 }; static f36 = 36; static f37 = "s37"; static f38 = { v: 38 }; static f39 = 39;
  static f40 = "s40"; static f41 = { v: 41 }; static f42 = 42; static f43 = "s43"; static f44 = { v: 44 }; static f45 = 45; static f46 = "s46"; static f47 = { v: 47 };
  static f48 = 48; static f49 = "s49"; static f50 = { v: 50 }; static f51 = 51; static f52 = "s52"; static f53 = { v: 53 }; static f54 = 54; static f55 = "s55";
  static f56 = { v: 56 }; static f57 = 57; static f58 = "s58"; static f59 = { v: 59 }; static f60 = 60; static f61 = "s61"; static f62 = { v: 62 }; static f63 = 63;
  static f64 = "s64"; static f65 = { v: 65 }; static f66 = 66; static f67 = "s67"; static f68 = { v: 68 }; static f69 = 69; static f70 = "s70"; static f71 = { v: 71 };
  static f72 = 72; static f73 = "s73"; static f74 = { v: 74 }; static f75 = 75; static f76 = "s76"; static f77 = { v: 77 }; static f78 = 78; static f79 = "s79";
  static f80 = { v: 80 }; static f81 = 81; static f82 = "s82"; static f83 = { v: 83 }; static f84 = 84; static f85 = "s85"; static f86 = { v: 86 }; static f87 = 87;
  static f88 = "s88"; static f89 = { v: 89 }; static f90 = 90; static f91 = "s91"; static f92 = { v: 92 }; static f93 = 93; static f94 = "s94"; static f95 = { v: 95 };
  static f96 = 96; static f97 = "s97"; static f98 = { v: 98 }; static f99 = 99; static f100 = "s100"; static f101 = { v: 101 }; static f102 = 102; static f103 = "s103";
  static f104 = { v: 104 }; static f105 = 105; static f106 = "s106"; static f107 = { v: 107 }; static f108 = 108; static f109 = "s109"; static f110 = { v: 110 }; static f111 = 111;
  static f112 = "s112"; static f113 = { v: 113 }; static f114 = 114; static f115 = "s115"; static f116 = { v: 116 }; static f117 = 117; static f118 = "s118"; static f119 = { v: 119 };
  static f120 = 120; static f121 = "s121"; static f122 = { v: 122 }; static f123 = 123; static f124 = "s124"; static f125 = { v: 125 }; static f126 = 126; static f127 = "s127";
  static f128 = { v: 128 }; static f129 = 129;
}
class Below extends Above { static own = 1; static f64 = "below"; }
list("below", Below);
Below.f0 = "stored below";
list("below again", Below);
list("above", Above);

const made = [];
for (let i = 0; i < 3; i++) {
  made.push(
    class InALoop {
      static f0 = 0; static f1 = "s1"; static f2 = { v: 2 }; static f3 = 3; static f4 = "s4"; static f5 = { v: 5 }; static f6 = 6; static f7 = "s7";
      static f8 = { v: 8 }; static f9 = 9; static f10 = "s10"; static f11 = { v: 11 }; static f12 = 12; static f13 = "s13"; static f14 = { v: 14 }; static f15 = 15;
      static f16 = "s16"; static f17 = { v: 17 }; static f18 = 18; static f19 = "s19"; static f20 = { v: 20 }; static f21 = 21; static f22 = "s22"; static f23 = { v: 23 };
      static f24 = 24; static f25 = "s25"; static f26 = { v: 26 }; static f27 = 27; static f28 = "s28"; static f29 = { v: 29 }; static f30 = 30; static f31 = "s31";
      static f32 = { v: 32 }; static f33 = 33; static f34 = "s34"; static f35 = { v: 35 }; static f36 = 36; static f37 = "s37"; static f38 = { v: 38 }; static f39 = 39;
      static f40 = "s40"; static f41 = { v: 41 }; static f42 = 42; static f43 = "s43"; static f44 = { v: 44 }; static f45 = 45; static f46 = "s46"; static f47 = { v: 47 };
      static f48 = 48; static f49 = "s49"; static f50 = { v: 50 }; static f51 = 51; static f52 = "s52"; static f53 = { v: 53 }; static f54 = 54; static f55 = "s55";
      static f56 = { v: 56 }; static f57 = 57; static f58 = "s58"; static f59 = { v: 59 }; static f60 = 60; static f61 = "s61"; static f62 = { v: 62 }; static f63 = 63;
      static f64 = "s64"; static f65 = { v: 65 }; static f66 = 66; static f67 = "s67"; static f68 = { v: 68 }; static f69 = 69; static f70 = "s70"; static f71 = { v: 71 };
      static f72 = 72; static f73 = "s73"; static f74 = { v: 74 }; static f75 = 75; static f76 = "s76"; static f77 = { v: 77 }; static f78 = 78; static f79 = "s79";
      static f80 = { v: 80 }; static f81 = 81; static f82 = "s82"; static f83 = { v: 83 }; static f84 = 84; static f85 = "s85"; static f86 = { v: 86 }; static f87 = 87;
      static f88 = "s88"; static f89 = { v: 89 }; static f90 = 90; static f91 = "s91"; static f92 = { v: 92 }; static f93 = 93; static f94 = "s94"; static f95 = { v: 95 };
      static f96 = 96; static f97 = "s97"; static f98 = { v: 98 }; static f99 = 99; static f100 = "s100"; static f101 = { v: 101 }; static f102 = 102; static f103 = "s103";
      static f104 = { v: 104 }; static f105 = 105; static f106 = "s106"; static f107 = { v: 107 }; static f108 = 108; static f109 = "s109"; static f110 = { v: 110 }; static f111 = 111;
      static f112 = "s112"; static f113 = { v: 113 }; static f114 = 114; static f115 = "s115"; static f116 = { v: 116 }; static f117 = 117; static f118 = "s118"; static f119 = { v: 119 };
      static f120 = 120; static f121 = "s121"; static f122 = { v: 122 }; static f123 = 123; static f124 = "s124"; static f125 = { v: 125 }; static f126 = 126; static f127 = "s127";
      static f128 = { v: 128 }; static f129 = 129;
      static which = i;
    },
  );
}
made[1].f0 = "second";
delete made[2].f129;
made.forEach((each, at) => list("in a loop " + at + " " + each.which, each));
