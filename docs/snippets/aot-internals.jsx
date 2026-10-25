// The figures of docs/bundler/aot-internals.mdx. Each is one inline SVG that takes its color from the text around it.
// On a narrow screen a figure keeps its size and scrolls sideways. Its right edge fades out where there is more to see.

export const Pipeline = () => (
  <div
    style={{
      overflowX: "auto",
      padding: "0 20px",
      WebkitMaskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
      maskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
    }}
  >
    <svg
      viewBox="0 0 720 640"
      width="100%"
      style={{ minWidth: "680px" }}
      fill="currentColor"
      fontFamily="ui-sans-serif, system-ui, sans-serif"
      role="img"
      aria-label="The stages of bun compile, from source files to one executable"
    >
      <rect
        x="8"
        y="8"
        width="704"
        height="186"
        rx="6"
        fill="#ec4899"
        fillOpacity="0.04"
        stroke="#ec4899"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      <text x="20" y="28" fontSize="13" fill="#ec4899" fontWeight="600">
        {"Bun, in Rust"}
      </text>
      <text x="112" y="28" fontSize="11" fontFamily="ui-monospace, Menlo, Consolas, monospace" fillOpacity="0.75">
        {"src/aot  src/sema"}
      </text>
      <rect
        x="20"
        y="44"
        width="128"
        height="76"
        rx="6"
        fill="#ec4899"
        fillOpacity="0.07"
        stroke="#ec4899"
        strokeWidth="1.2"
      />
      <text x="84" y="73.2" fontSize="12.5" textAnchor="middle" fontWeight="600">
        {"Load"}
      </text>
      <text x="84" y="86.8" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"resolve, parse once,"}
      </text>
      <text x="84" y="100.2" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"loaders, macros, plugins"}
      </text>
      <text
        x="84"
        y="136"
        fontSize="9.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fillOpacity="0.7"
      >
        {"src/aot/load"}
      </text>
      <rect
        x="158"
        y="44"
        width="128"
        height="76"
        rx="6"
        fill="#ec4899"
        fillOpacity="0.07"
        stroke="#ec4899"
        strokeWidth="1.2"
      />
      <text x="222" y="73.2" fontSize="12.5" textAnchor="middle" fontWeight="600">
        {"Bind modules"}
      </text>
      <text x="222" y="86.8" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"ES links, CommonJS"}
      </text>
      <text x="222" y="100.2" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"exports, order, folding"}
      </text>
      <text
        x="222"
        y="136"
        fontSize="9.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fillOpacity="0.7"
      >
        {"src/aot/modules"}
      </text>
      <rect
        x="296"
        y="44"
        width="128"
        height="76"
        rx="6"
        fill="#ec4899"
        fillOpacity="0.07"
        stroke="#ec4899"
        strokeWidth="1.2"
      />
      <text x="360" y="73.2" fontSize="12.5" textAnchor="middle" fontWeight="600">
        {"Check + lower"}
      </text>
      <text x="360" y="86.8" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"one checker per thread,"}
      </text>
      <text x="360" y="100.2" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"one file at a time"}
      </text>
      <text
        x="360"
        y="136"
        fontSize="9.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fillOpacity="0.7"
      >
        {"src/sema  src/aot/lower"}
      </text>
      <rect
        x="434"
        y="44"
        width="128"
        height="76"
        rx="6"
        fill="#ec4899"
        fillOpacity="0.07"
        stroke="#ec4899"
        strokeWidth="1.2"
      />
      <text x="498" y="73.2" fontSize="12.5" textAnchor="middle" fontWeight="600">
        {"Link"}
      </text>
      <text x="498" y="86.8" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"unite types, layouts,"}
      </text>
      <text x="498" y="100.2" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"keys; number everything"}
      </text>
      <text
        x="498"
        y="136"
        fontSize="9.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fillOpacity="0.7"
      >
        {"src/aot/link"}
      </text>
      <rect
        x="572"
        y="44"
        width="128"
        height="76"
        rx="6"
        fill="#ec4899"
        fillOpacity="0.07"
        stroke="#ec4899"
        strokeWidth="1.2"
      />
      <text x="636" y="73.2" fontSize="12.5" textAnchor="middle" fontWeight="600">
        {"Emit"}
      </text>
      <text x="636" y="86.8" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"sections of words,"}
      </text>
      <text x="636" y="100.2" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"a hash of the schema"}
      </text>
      <text
        x="636"
        y="136"
        fontSize="9.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fillOpacity="0.7"
      >
        {"src/aot/emit"}
      </text>
      <path
        d="M148 82 L153.2 82"
        fill="none"
        stroke="#ec4899"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M158 82 L152.5 84.4 L152.5 79.6 Z" fill="#ec4899" />
      <path
        d="M286 82 L291.2 82"
        fill="none"
        stroke="#ec4899"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M296 82 L290.5 84.4 L290.5 79.6 Z" fill="#ec4899" />
      <path
        d="M424 82 L429.2 82"
        fill="none"
        stroke="#ec4899"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M434 82 L428.5 84.4 L428.5 79.6 Z" fill="#ec4899" />
      <path
        d="M562 82 L567.2 82"
        fill="none"
        stroke="#ec4899"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M572 82 L566.5 84.4 L566.5 79.6 Z" fill="#ec4899" />
      <text x="153" y="160" fontSize="10" textAnchor="middle" fontStyle="italic" fillOpacity="0.85">
        {"syntax trees"}
      </text>
      <path
        d="M153 86 L153 149"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray="2 3"
        strokeOpacity="0.5"
      />
      <text x="291" y="160" fontSize="10" textAnchor="middle" fontStyle="italic" fillOpacity="0.85">
        {"module graph"}
      </text>
      <path
        d="M291 86 L291 149"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray="2 3"
        strokeOpacity="0.5"
      />
      <text x="429" y="160" fontSize="10" textAnchor="middle" fontStyle="italic" fillOpacity="0.85">
        {"IR, file by file"}
      </text>
      <path
        d="M429 86 L429 149"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray="2 3"
        strokeOpacity="0.5"
      />
      <text x="567" y="160" fontSize="10" textAnchor="middle" fontStyle="italic" fillOpacity="0.85">
        {"one program"}
      </text>
      <path
        d="M567 86 L567 149"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray="2 3"
        strokeOpacity="0.5"
      />
      <text x="20" y="182" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fillOpacity="0.8">
        {".ts  .tsx  .js  .json  .wasm  node_modules  Bun's own node:* and bun:* modules"}
      </text>
      <path
        d="M700 82 L706 82 L706 216 L60 216 L60 256.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M60 262 L57.1 255.6 L62.9 255.6 Z" fill="currentColor" />
      <text x="360" y="211" fontSize="10.5" textAnchor="middle" fontStyle="italic">
        {"program bytes: one format, generated for both sides from aot/ir/AOTSchema.def"}
      </text>
      <rect
        x="8"
        y="226"
        width="704"
        height="300"
        rx="6"
        fill="#3b82f6"
        fillOpacity="0.04"
        stroke="#3b82f6"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      <text x="76" y="247" fontSize="13" fill="#3b82f6" fontWeight="600">
        {"JavaScriptCore, in C++"}
      </text>
      <text x="236" y="247" fontSize="11" fontFamily="ui-monospace, Menlo, Consolas, monospace" fillOpacity="0.75">
        {"Source/JavaScriptCore/aot"}
      </text>
      <rect
        x="20"
        y="262"
        width="158"
        height="84"
        rx="6"
        fill="#3b82f6"
        fillOpacity="0.07"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <text x="99" y="288.5" fontSize="12.5" textAnchor="middle" fontWeight="600">
        {"Read, type, verify"}
      </text>
      <text x="99" y="302" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"every value gets a"}
      </text>
      <text x="99" y="315.5" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"proven type; requests"}
      </text>
      <text x="99" y="329" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"for types become checks"}
      </text>
      <text x="24" y="360" fontSize="9.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fillOpacity="0.7">
        {"ir/"}
      </text>
      <text
        x="174"
        y="360"
        fontSize="9.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#3b82f6"
        textAnchor="end"
        fontWeight="600"
      >
        {"AsRead"}
      </text>
      <rect
        x="194"
        y="262"
        width="158"
        height="84"
        rx="6"
        fill="#3b82f6"
        fillOpacity="0.07"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <text x="273" y="288.5" fontSize="12.5" textAnchor="middle" fontWeight="600">
        {"Flow"}
      </text>
      <text x="273" y="302" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"whole program: what"}
      </text>
      <text x="273" y="315.5" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"reaches each position;"}
      </text>
      <text x="273" y="329" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"answers most checks"}
      </text>
      <text x="198" y="360" fontSize="9.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fillOpacity="0.7">
        {"valueflow/"}
      </text>
      <text
        x="348"
        y="360"
        fontSize="9.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#3b82f6"
        textAnchor="end"
        fontWeight="600"
      >
        {"Prepared"}
      </text>
      <rect
        x="368"
        y="262"
        width="158"
        height="84"
        rx="6"
        fill="#3b82f6"
        fillOpacity="0.07"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <text x="447" y="288.5" fontSize="12.5" textAnchor="middle" fontWeight="600">
        {"Optimize"}
      </text>
      <text x="447" y="302" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"generic versions, direct"}
      </text>
      <text x="447" y="315.5" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"calls, slots, inlining,"}
      </text>
      <text x="447" y="329" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"sinking, guards"}
      </text>
      <text x="372" y="360" fontSize="9.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fillOpacity="0.7">
        {"passes/  analysis/"}
      </text>
      <text
        x="522"
        y="360"
        fontSize="9.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#3b82f6"
        textAnchor="end"
        fontWeight="600"
      >
        {"Prepared"}
      </text>
      <rect
        x="542"
        y="262"
        width="158"
        height="84"
        rx="6"
        fill="#3b82f6"
        fillOpacity="0.07"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <text x="621" y="288.5" fontSize="12.5" textAnchor="middle" fontWeight="600">
        {"Slots + select"}
      </text>
      <text x="621" y="302" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"where each field lies;"}
      </text>
      <text x="621" y="315.5" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"operations take the"}
      </text>
      <text x="621" y="329" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"forms that have code"}
      </text>
      <text x="546" y="360" fontSize="9.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fillOpacity="0.7">
        {"place/  select/"}
      </text>
      <text
        x="696"
        y="360"
        fontSize="9.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#3b82f6"
        textAnchor="end"
        fontWeight="600"
      >
        {"Selected"}
      </text>
      <path
        d="M178 304 L189.2 304"
        fill="none"
        stroke="#3b82f6"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M194 304 L188.5 306.4 L188.5 301.6 Z" fill="#3b82f6" />
      <path
        d="M352 304 L363.2 304"
        fill="none"
        stroke="#3b82f6"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M368 304 L362.5 306.4 L362.5 301.6 Z" fill="#3b82f6" />
      <path
        d="M526 304 L537.2 304"
        fill="none"
        stroke="#3b82f6"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M542 304 L536.5 306.4 L536.5 301.6 Z" fill="#3b82f6" />
      <path
        d="M621 346 L621 384 L99 384 L99 394.4"
        fill="none"
        stroke="#3b82f6"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M99 400 L96.1 393.6 L101.9 393.6 Z" fill="#3b82f6" />
      <rect
        x="20"
        y="400"
        width="158"
        height="68"
        rx="6"
        fill="#3b82f6"
        fillOpacity="0.07"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <text x="99" y="425.2" fontSize="12.5" textAnchor="middle" fontWeight="600">
        {"Number + place"}
      </text>
      <text x="99" y="438.8" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"shape numbers, tables,"}
      </text>
      <text x="99" y="452.2" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"cache slots, statics"}
      </text>
      <text x="24" y="482" fontSize="9.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fillOpacity="0.7">
        {"place/"}
      </text>
      <text
        x="174"
        y="482"
        fontSize="9.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#3b82f6"
        textAnchor="end"
        fontWeight="600"
      >
        {"Placed"}
      </text>
      <rect
        x="194"
        y="400"
        width="158"
        height="68"
        rx="6"
        fill="#3b82f6"
        fillOpacity="0.07"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <text x="273" y="425.2" fontSize="12.5" textAnchor="middle" fontWeight="600">
        {"Represent"}
      </text>
      <text x="273" y="438.8" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"Int32, Double, Cell32"}
      </text>
      <text x="273" y="452.2" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"or JSValue per value"}
      </text>
      <text x="198" y="482" fontSize="9.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fillOpacity="0.7">
        {"represent/"}
      </text>
      <text
        x="348"
        y="482"
        fontSize="9.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#3b82f6"
        textAnchor="end"
        fontWeight="600"
      >
        {"Placed"}
      </text>
      <rect
        x="368"
        y="400"
        width="158"
        height="68"
        rx="6"
        fill="#3b82f6"
        fillOpacity="0.07"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <text x="447" y="425.2" fontSize="12.5" textAnchor="middle" fontWeight="600">
        {"Generate code"}
      </text>
      <text x="447" y="438.8" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"IR to B3 to Air to"}
      </text>
      <text x="447" y="452.2" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"machine code; stubs"}
      </text>
      <text x="372" y="482" fontSize="9.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fillOpacity="0.7">
        {"codegen/ stubs/"}
      </text>
      <text
        x="522"
        y="482"
        fontSize="9.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#3b82f6"
        textAnchor="end"
        fontWeight="600"
      >
        {"B3, Air"}
      </text>
      <rect
        x="542"
        y="400"
        width="158"
        height="68"
        rx="6"
        fill="#3b82f6"
        fillOpacity="0.07"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <text x="621" y="425.2" fontSize="12.5" textAnchor="middle" fontWeight="600">
        {"Image"}
      </text>
      <text x="621" y="438.8" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"lay out, link, outline,"}
      </text>
      <text x="621" y="452.2" fontSize="10" textAnchor="middle" fillOpacity="0.8">
        {"fold; read-only tables"}
      </text>
      <text x="546" y="482" fontSize="9.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fillOpacity="0.7">
        {"image/"}
      </text>
      <text
        x="696"
        y="482"
        fontSize="9.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#3b82f6"
        textAnchor="end"
        fontWeight="600"
      >
        {"bytes"}
      </text>
      <path
        d="M178 434 L189.2 434"
        fill="none"
        stroke="#3b82f6"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M194 434 L188.5 436.4 L188.5 431.6 Z" fill="#3b82f6" />
      <path
        d="M352 434 L363.2 434"
        fill="none"
        stroke="#3b82f6"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M368 434 L362.5 436.4 L362.5 431.6 Z" fill="#3b82f6" />
      <path
        d="M526 434 L537.2 434"
        fill="none"
        stroke="#3b82f6"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M542 434 L536.5 436.4 L536.5 431.6 Z" fill="#3b82f6" />
      <text x="20" y="512" fontSize="10.5" fontStyle="italic">
        {
          "In blue under each stage: the form of the IR that it leaves behind. The verifier runs where the form changes."
        }
      </text>
      <path
        d="M700 434 L706 434 L706 540 L560 540 L560 550.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M560 556 L557.1 549.6 L562.9 549.6 Z" fill="currentColor" />
      <text x="548" y="545" fontSize="10.5" textAnchor="end" fontStyle="italic">
        {"image: machine code + read-only data"}
      </text>
      <rect
        x="8"
        y="556"
        width="704"
        height="76"
        rx="6"
        fill="#ec4899"
        fillOpacity="0.04"
        stroke="#ec4899"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      <text x="20" y="577" fontSize="13" fill="#ec4899" fontWeight="600">
        {"Bun, in Rust"}
      </text>
      <text x="112" y="577" fontSize="11" fontFamily="ui-monospace, Menlo, Consolas, monospace" fillOpacity="0.75">
        {"src/bundler/aot  src/exe_format  src/trim"}
      </text>
      <rect
        x="20"
        y="590"
        width="300"
        height="30"
        rx="6"
        fill="#14b8a6"
        fillOpacity="0.12"
        stroke="#14b8a6"
        strokeWidth="1.2"
      />
      <text x="170" y="609" fontSize="10.5" textAnchor="middle">
        {"a copy of bun: runtime, collector, interpreter"}
      </text>
      <rect
        x="320"
        y="590"
        width="150"
        height="30"
        rx="6"
        fill="currentColor"
        fillOpacity="0.02"
        stroke="currentColor"
        strokeWidth="1"
        strokeDasharray="4 3"
      />
      <text x="395" y="609" fontSize="10.5" textAnchor="middle" fillOpacity="0.6">
        {"CLI, JITs, trimmed APIs"}
      </text>
      <path
        d="M326 615 L464 595"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeOpacity="0.5"
      />
      <rect
        x="470"
        y="590"
        width="230"
        height="30"
        rx="6"
        fill="#3b82f6"
        fillOpacity="0.14"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <text x="585" y="609" fontSize="10.5" textAnchor="middle">
        {"the image, in a section of its own"}
      </text>
    </svg>
  </div>
);

export const FactAndPrediction = () => (
  <div
    style={{
      overflowX: "auto",
      padding: "0 20px",
      WebkitMaskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
      maskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
    }}
  >
    <svg
      viewBox="0 0 720 400"
      width="100%"
      style={{ minWidth: "680px" }}
      fill="currentColor"
      fontFamily="ui-sans-serif, system-ui, sans-serif"
      role="img"
      aria-label="A value the program makes keeps a proven type. A value the program receives has an expected type until a test passes"
    >
      <text x="16" y="24" fontSize="13" fill="#16a34a" fontWeight="600">
        {"Made by the program: the type is a fact"}
      </text>
      <rect
        x="16"
        y="38"
        width="150"
        height="54"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.08"
        stroke="#16a34a"
        strokeWidth="1.2"
      />
      <text
        x="91"
        y="60"
        fontSize="11.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fontWeight="600"
      >
        {"{ x: 1, y: 0.5 }"}
      </text>
      <text x="91" y="78" fontSize="10" textAnchor="middle" fillOpacity="0.85">
        {"an object literal of type Vec"}
      </text>
      <rect
        x="190"
        y="38"
        width="160"
        height="54"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.08"
        stroke="#16a34a"
        strokeWidth="1.2"
      />
      <text
        x="270"
        y="60"
        fontSize="11.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fontWeight="600"
      >
        {"NewObject layout=L0"}
      </text>
      <text x="270" y="78" fontSize="10" textAnchor="middle" fillOpacity="0.85">
        {"the operation fixes the layout"}
      </text>
      <rect
        x="374"
        y="38"
        width="160"
        height="54"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.08"
        stroke="#16a34a"
        strokeWidth="1.2"
      />
      <text
        x="454"
        y="60"
        fontSize="11.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fontWeight="600"
      >
        {"argument a of dot"}
      </text>
      <text x="454" y="78" fontSize="10" textAnchor="middle" fillOpacity="0.85">
        {"flow: every caller passes L0"}
      </text>
      <rect
        x="558"
        y="38"
        width="146"
        height="54"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.08"
        stroke="#16a34a"
        strokeWidth="1.2"
      />
      <text
        x="631"
        y="60"
        fontSize="11.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fontWeight="600"
      >
        {"a.x"}
      </text>
      <text x="631" y="78" fontSize="10" textAnchor="middle" fillOpacity="0.85">
        {"GetSlot: one load"}
      </text>
      <path
        d="M166 65 L184.4 65"
        fill="none"
        stroke="#16a34a"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M190 65 L183.6 67.9 L183.6 62.1 Z" fill="#16a34a" />
      <path
        d="M350 65 L368.4 65"
        fill="none"
        stroke="#16a34a"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M374 65 L367.6 67.9 L367.6 62.1 Z" fill="#16a34a" />
      <path
        d="M534 65 L552.4 65"
        fill="none"
        stroke="#16a34a"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M558 65 L551.6 67.9 L551.6 62.1 Z" fill="#16a34a" />
      <text
        x="270"
        y="108"
        fontSize="11"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#16a34a"
        textAnchor="middle"
        fontWeight="600"
      >
        {"L0"}
      </text>
      <text
        x="454"
        y="108"
        fontSize="11"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#16a34a"
        textAnchor="middle"
        fontWeight="600"
      >
        {"L0"}
      </text>
      <text
        x="631"
        y="108"
        fontSize="11"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#16a34a"
        textAnchor="middle"
        fontWeight="600"
      >
        {"int"}
      </text>
      <text x="16" y="108" fontSize="10" fontStyle="italic" fillOpacity="0.8">
        {"proven type"}
      </text>
      <path
        d="M16 132 L704 132"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray="2 4"
        strokeOpacity="0.4"
      />
      <text x="16" y="160" fontSize="13" fill="#d97706" fontWeight="600">
        {"Received from outside: the type is a prediction"}
      </text>
      <rect
        x="16"
        y="174"
        width="150"
        height="54"
        rx="6"
        fill="#d97706"
        fillOpacity="0.08"
        stroke="#d97706"
        strokeWidth="1.2"
      />
      <text
        x="91"
        y="196"
        fontSize="11.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fontWeight="600"
      >
        {"JSON.parse(text)"}
      </text>
      <text x="91" y="214" fontSize="10" textAnchor="middle" fillOpacity="0.85">
        {"data from outside"}
      </text>
      <rect
        x="190"
        y="174"
        width="160"
        height="54"
        rx="6"
        fill="#d97706"
        fillOpacity="0.08"
        stroke="#d97706"
        strokeWidth="1.2"
      />
      <text
        x="270"
        y="196"
        fontSize="11.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fontWeight="600"
      >
        {"message.vec"}
      </text>
      <text x="270" y="214" fontSize="10" textAnchor="middle" fillOpacity="0.85">
        {"PropGet: a lookup by name"}
      </text>
      <rect
        x="374"
        y="174"
        width="160"
        height="54"
        rx="6"
        fill="#d97706"
        fillOpacity="0.08"
        stroke="#d97706"
        strokeWidth="1.2"
      />
      <text
        x="454"
        y="196"
        fontSize="11.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fontWeight="600"
      >
        {"argument b of dot"}
      </text>
      <text x="454" y="214" fontSize="10" textAnchor="middle" fillOpacity="0.85">
        {"declared Vec, nothing proven"}
      </text>
      <path
        d="M166 201 L184.4 201"
        fill="none"
        stroke="#d97706"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M190 201 L183.6 203.9 L183.6 198.1 Z" fill="#d97706" />
      <path
        d="M350 201 L368.4 201"
        fill="none"
        stroke="#d97706"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M374 201 L367.6 203.9 L367.6 198.1 Z" fill="#d97706" />
      <text
        x="91"
        y="244"
        fontSize="11"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#d97706"
        textAnchor="middle"
        fontWeight="600"
      >
        {"object | ..."}
      </text>
      <text
        x="270"
        y="244"
        fontSize="11"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#d97706"
        textAnchor="middle"
        fontWeight="600"
      >
        {"anything"}
      </text>
      <text
        x="454"
        y="244"
        fontSize="11"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#d97706"
        textAnchor="middle"
        fontWeight="600"
      >
        {"anything ~ L0"}
      </text>
      <text x="540" y="244" fontSize="10" fontStyle="italic" fillOpacity="0.8">
        {"proven ~ expected"}
      </text>
      <path
        d="M454 252 L454 276.4"
        fill="none"
        stroke="#d97706"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M454 282 L451.1 275.6 L456.9 275.6 Z" fill="#d97706" />
      <path
        d="M454 282 L532 312 L454 342 L376 312 Z"
        fill="#d97706"
        fillOpacity="0.1"
        stroke="#d97706"
        strokeWidth="1.2"
      />
      <text
        x="454"
        y="310"
        fontSize="11.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fontWeight="600"
      >
        {"TypeTest"}
      </text>
      <text x="454" y="325" fontSize="10" textAnchor="middle" fillOpacity="0.85">
        {"is it an L0?"}
      </text>
      <path
        d="M532 312 L552.4 312"
        fill="none"
        stroke="#16a34a"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M558 312 L551.6 314.9 L551.6 309.1 Z" fill="#16a34a" />
      <text x="545" y="305" fontSize="10.5" fill="#16a34a" textAnchor="end" fontWeight="600">
        {"yes"}
      </text>
      <rect
        x="558"
        y="285"
        width="146"
        height="54"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.08"
        stroke="#16a34a"
        strokeWidth="1.2"
      />
      <text
        x="631"
        y="307"
        fontSize="11.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fontWeight="600"
      >
        {"b.x"}
      </text>
      <text x="631" y="325" fontSize="9.5" textAnchor="middle" fillOpacity="0.85">
        {"a fact from here on: one load"}
      </text>
      <path
        d="M376 312 L355.6 312"
        fill="none"
        stroke="#8b5cf6"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M350 312 L356.4 309.1 L356.4 314.9 Z" fill="#8b5cf6" />
      <text x="364" y="305" fontSize="10.5" fill="#8b5cf6" fontWeight="600">
        {"no"}
      </text>
      <rect
        x="130"
        y="285"
        width="220"
        height="54"
        rx="6"
        fill="#8b5cf6"
        fillOpacity="0.08"
        stroke="#8b5cf6"
        strokeWidth="1.2"
      />
      <text x="240" y="307" fontSize="11.5" textAnchor="middle" fontWeight="600">
        {"generic version of dot"}
      </text>
      <text x="240" y="325" fontSize="10" textAnchor="middle" fillOpacity="0.85">
        {"plain JavaScript semantics, by name"}
      </text>
      <text x="240" y="362" fontSize="10.5" textAnchor="middle" fontStyle="italic">
        {"same value, same object, same answer as bun run"}
      </text>
      <text x="240" y="378" fontSize="10.5" textAnchor="middle" fontStyle="italic">
        {"nothing throws, converts or copies"}
      </text>
      <text x="631" y="362" fontSize="10.5" textAnchor="middle" fontStyle="italic">
        {"the test is not repeated"}
      </text>
      <text x="631" y="378" fontSize="10.5" textAnchor="middle" fontStyle="italic">
        {"while the proof lasts"}
      </text>
    </svg>
  </div>
);

export const DeclaredType = () => (
  <div
    style={{
      overflowX: "auto",
      padding: "0 20px",
      WebkitMaskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
      maskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
    }}
  >
    <svg
      viewBox="0 0 720 520"
      width="100%"
      style={{ minWidth: "680px" }}
      fill="currentColor"
      fontFamily="ui-sans-serif, system-ui, sans-serif"
      role="img"
      aria-label="What becomes of a declared type: a request, then nothing, a cast, or a check, and what flow makes of the check"
    >
      <rect
        x="220"
        y="10"
        width="280"
        height="46"
        rx="6"
        fill="#ec4899"
        fillOpacity="0.07"
        stroke="#ec4899"
        strokeWidth="1.2"
      />
      <text
        x="360"
        y="30.8"
        fontSize="11.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fontWeight="600"
      >
        {"Convert v declared={type=T}"}
      </text>
      <text x="360" y="43.8" fontSize="9.5" textAnchor="middle" fillOpacity="0.8">
        {"what the front end writes at each typed position"}
      </text>
      <path
        d="M360 56 L360 66.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M360 72 L357.1 65.6 L362.9 65.6 Z" fill="currentColor" />
      <path
        d="M360 72 L488 106 L360 140 L232 106 Z"
        fill="#3b82f6"
        fillOpacity="0.08"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <text x="360" y="103" fontSize="10.5" textAnchor="middle">
        {"Does T come from a file"}
      </text>
      <text x="360" y="116" fontSize="10.5" textAnchor="middle">
        {"that the checker checked?"}
      </text>
      <path
        d="M232 106 L150 106 L150 128.4"
        fill="none"
        stroke="#d97706"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M150 134 L147.1 127.6 L152.9 127.6 Z" fill="#d97706" />
      <text x="224" y="99" fontSize="10" fill="#d97706" textAnchor="end" fontWeight="600">
        {"no: .js, .d.ts"}
      </text>
      <rect
        x="30"
        y="134"
        width="240"
        height="50"
        rx="6"
        fill="#d97706"
        fillOpacity="0.07"
        stroke="#d97706"
        strokeWidth="1.2"
      />
      <text x="150" y="150.8" fontSize="12.5" textAnchor="middle" fontWeight="600">
        {"expected type only"}
      </text>
      <text x="150" y="163.8" fontSize="9.5" textAnchor="middle" fillOpacity="0.8">
        {"v: anything ~ T. No test here. A pass may"}
      </text>
      <text x="150" y="176.8" fontSize="9.5" textAnchor="middle" fillOpacity="0.8">
        {"place one in front of a stretch of uses"}
      </text>
      <path
        d="M360 140 L360 154.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M360 160 L357.1 153.6 L362.9 153.6 Z" fill="currentColor" />
      <text x="368" y="154" fontSize="10" fontWeight="600">
        {"yes"}
      </text>
      <path
        d="M360 160 L488 196 L360 232 L232 196 Z"
        fill="#3b82f6"
        fillOpacity="0.08"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <text x="360" y="193" fontSize="10.5" textAnchor="middle">
        {"Is the proven type of v"}
      </text>
      <text x="360" y="206" fontSize="10.5" textAnchor="middle">
        {"already inside T?"}
      </text>
      <text x="500" y="128" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace" fillOpacity="0.7">
        {"TypeValues"}
      </text>
      <path
        d="M488 196 L560 196 L560 210.4"
        fill="none"
        stroke="#16a34a"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M560 216 L557.1 209.6 L562.9 209.6 Z" fill="#16a34a" />
      <text x="496" y="189" fontSize="10" fill="#16a34a" fontWeight="600">
        {"yes"}
      </text>
      <rect
        x="470"
        y="216"
        width="220"
        height="40"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.07"
        stroke="#16a34a"
        strokeWidth="1.2"
      />
      <text x="580" y="234.2" fontSize="12.5" textAnchor="middle" fontWeight="600">
        {"nothing, or Upcast"}
      </text>
      <text x="580" y="247.2" fontSize="9.5" textAnchor="middle" fillOpacity="0.8">
        {"no code"}
      </text>
      <path
        d="M360 232 L360 246.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M360 252 L357.1 245.6 L362.9 245.6 Z" fill="currentColor" />
      <text x="368" y="246" fontSize="10" fontWeight="600">
        {"no"}
      </text>
      <rect
        x="270"
        y="252"
        width="180"
        height="36"
        rx="6"
        fill="#3b82f6"
        fillOpacity="0.07"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <text
        x="360"
        y="274.2"
        fontSize="11.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fontWeight="600"
      >
        {"Check v castType=T"}
      </text>
      <path
        d="M360 288 L360 300.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M360 306 L357.1 299.6 L362.9 299.6 Z" fill="currentColor" />
      <path
        d="M360 306 L510 346 L360 386 L210 346 Z"
        fill="#3b82f6"
        fillOpacity="0.08"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <text x="360" y="343" fontSize="10.5" textAnchor="middle">
        {"Flow: what can arrive here,"}
      </text>
      <text x="360" y="356" fontSize="10.5" textAnchor="middle">
        {"over the whole program?"}
      </text>
      <text x="520" y="318" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace" fillOpacity="0.7">
        {"AnalyzeFlow, ApplyFlowResults"}
      </text>
      <path
        d="M210 346 L122 346 L122 394.4"
        fill="none"
        stroke="#16a34a"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M122 400 L119.1 393.6 L124.9 393.6 Z" fill="#16a34a" />
      <text x="202" y="339" fontSize="10" fill="#16a34a" textAnchor="end" fontWeight="600">
        {"only values in T"}
      </text>
      <rect
        x="16"
        y="400"
        width="212"
        height="58"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.07"
        stroke="#16a34a"
        strokeWidth="1.2"
      />
      <text
        x="122"
        y="420.8"
        fontSize="12.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fontWeight="600"
      >
        {"AssumeType"}
      </text>
      <text x="122" y="433.8" fontSize="9.5" textAnchor="middle" fillOpacity="0.8">
        {"the check is answered:"}
      </text>
      <text x="122" y="446.8" fontSize="9.5" textAnchor="middle" fillOpacity="0.8">
        {"no code, the type is a fact"}
      </text>
      <path
        d="M360 386 L360 394.4"
        fill="none"
        stroke="#d97706"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M360 400 L357.1 393.6 L362.9 393.6 Z" fill="#d97706" />
      <text x="368" y="397" fontSize="10" fill="#d97706" fontWeight="600">
        {"can't tell"}
      </text>
      <rect
        x="244"
        y="400"
        width="232"
        height="58"
        rx="6"
        fill="#d97706"
        fillOpacity="0.07"
        stroke="#d97706"
        strokeWidth="1.2"
      />
      <text
        x="360"
        y="420.8"
        fontSize="12.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fontWeight="600"
      >
        {"TypeTest + Branch"}
      </text>
      <text x="360" y="433.8" fontSize="9.5" textAnchor="middle" fillOpacity="0.8">
        {"hot: the failing edge enters the generic"}
      </text>
      <text x="360" y="446.8" fontSize="9.5" textAnchor="middle" fillOpacity="0.8">
        {"version. cold: a guard at each use"}
      </text>
      <path
        d="M510 346 L598 346 L598 394.4"
        fill="none"
        stroke="#8b5cf6"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M598 400 L595.1 393.6 L600.9 393.6 Z" fill="#8b5cf6" />
      <text x="518" y="339" fontSize="10" fill="#8b5cf6" fontWeight="600">
        {"saw a misfit arrive"}
      </text>
      <rect
        x="492"
        y="400"
        width="212"
        height="58"
        rx="6"
        fill="#8b5cf6"
        fillOpacity="0.07"
        stroke="#8b5cf6"
        strokeWidth="1.2"
      />
      <text x="598" y="420.8" fontSize="12.5" textAnchor="middle" fontWeight="600">
        {"the check is dropped"}
      </text>
      <text x="598" y="433.8" fontSize="9.5" textAnchor="middle" fillOpacity="0.8">
        {"a test would fail in ordinary runs,"}
      </text>
      <text x="598" y="446.8" fontSize="9.5" textAnchor="middle" fillOpacity="0.8">
        {"so the value goes on untyped"}
      </text>
      <text
        x="360"
        y="486"
        fontSize="10"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fillOpacity="0.7"
      >
        {"AddGenericVersion, SplitBehindEntryChecks, PlaceTypeTests"}
      </text>
      <text x="360" y="506" fontSize="11" textAnchor="middle" fontStyle="italic">
        {"Whichever way it goes, the program computes what it computes under bun run."}
      </text>
    </svg>
  </div>
);

export const Guard = () => (
  <div
    style={{
      overflowX: "auto",
      padding: "0 20px",
      WebkitMaskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
      maskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
    }}
  >
    <svg
      viewBox="0 0 720 500"
      width="100%"
      style={{ minWidth: "680px" }}
      fill="currentColor"
      fontFamily="ui-sans-serif, system-ui, sans-serif"
      role="img"
      aria-label="The loop of dot.ts as blocks of IR beside its x64 code: one guard, a fast path of two loads, a slow path that calls the generic version"
    >
      <text x="28" y="22" fontSize="12.5" fontWeight="600">
        {"IR, form Placed"}
      </text>
      <text x="400" y="22" fontSize="12.5" fontWeight="600">
        {"x64"}
      </text>
      <rect
        x="28"
        y="34"
        width="344"
        height="84"
        rx="6"
        fill="#d97706"
        fillOpacity="0.07"
        stroke="#d97706"
        strokeWidth="1.2"
      />
      <text
        x="38"
        y="51"
        fontSize="10.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#d97706"
        fontWeight="600"
      >
        {"b5"}
      </text>
      <text x="38" y="67" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {'v23: anything = PropGet v14 key="vec"'}
      </text>
      <text x="38" y="81" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"v25: boolean  = TypeTest v23 testedType=L0"}
      </text>
      <text x="38" y="95" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"TestAndBranch v25 -> taken b6, notTaken b7"}
      </text>
      <rect
        x="400"
        y="34"
        width="312"
        height="84"
        rx="6"
        fill="#d97706"
        fillOpacity="0.04"
        stroke="#d97706"
        strokeWidth="0.8"
      />
      <text x="410" y="53" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"call  GetByIdAtSite       ; message.vec"}
      </text>
      <text x="410" y="67" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"test  [r13+0x68], rax     ; not a cell?"}
      </text>
      <text x="410" y="81" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"jne   slow"}
      </text>
      <text x="410" y="95" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"cmp   dword [rax+0xc], -1 ; shape word of L0?"}
      </text>
      <text x="410" y="109" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"jne   slow"}
      </text>
      <rect
        x="28"
        y="146"
        width="344"
        height="106"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.07"
        stroke="#16a34a"
        strokeWidth="1.2"
      />
      <text
        x="38"
        y="163"
        fontSize="10.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#16a34a"
        fontWeight="600"
      >
        {"b6   the test passed: v26 is an L0"}
      </text>
      <text x="38" y="179" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {'v27: int    @Int32  = GetSlot v26 key="x"'}
      </text>
      <text x="38" y="193" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"v28: int    @Int32  = Mul 1, v27"}
      </text>
      <text x="38" y="207" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {'v29: number @Double = GetSlot v26 key="y"'}
      </text>
      <text x="38" y="221" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"v30: number @Double = Mul 0.5, v29"}
      </text>
      <text x="38" y="235" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"v31: number @Double = Add v28, v30"}
      </text>
      <rect
        x="400"
        y="146"
        width="312"
        height="106"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.04"
        stroke="#16a34a"
        strokeWidth="0.8"
      />
      <text x="410" y="165" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"pcmpeqd xmm0, xmm0 ..      ; xmm0 = 0.5"}
      </text>
      <text x="410" y="179" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"mulsd    xmm0, [rax+0x10]  ; 0.5 * b.y"}
      </text>
      <text x="410" y="193" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"cvtsi2sd xmm1, [rax+0x18]  ; 1 * b.x"}
      </text>
      <text x="410" y="207" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"addsd    xmm0, xmm1"}
      </text>
      <text x="410" y="221" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {""}
      </text>
      <text x="410" y="235" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"; unit.x and unit.y have become constants"}
      </text>
      <rect
        x="28"
        y="280"
        width="344"
        height="56"
        rx="6"
        fill="#8b5cf6"
        fillOpacity="0.07"
        stroke="#8b5cf6"
        strokeWidth="1.2"
      />
      <text
        x="38"
        y="297"
        fontSize="10.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#8b5cf6"
        fontWeight="600"
      >
        {"b7   unlikely"}
      </text>
      <text x="38" y="313" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"v32: number @Double = CallDirect v2, v23"}
      </text>
      <text x="38" y="327" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"function=f1156, the generic version of dot"}
      </text>
      <rect
        x="400"
        y="280"
        width="312"
        height="56"
        rx="6"
        fill="#8b5cf6"
        fillOpacity="0.04"
        stroke="#8b5cf6"
        strokeWidth="0.8"
      />
      <text x="410" y="299" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"slow:"}
      </text>
      <text x="410" y="313" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"mov   rdi, [rbp-0x28]      ; unit"}
      </text>
      <text x="410" y="327" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"call  dot                  ; b in rsi, boxed"}
      </text>
      <rect
        x="28"
        y="362"
        width="344"
        height="84"
        rx="6"
        fill="currentColor"
        fillOpacity="0.07"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <text x="38" y="379" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fontWeight="600">
        {"b8, then the loop header b4"}
      </text>
      <text x="38" y="395" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"v34: number @Double = Add v17, v33"}
      </text>
      <text x="38" y="409" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"v35: int    @Int32  = Increment v22"}
      </text>
      <text x="38" y="423" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"LoopHint"}
      </text>
      <text x="38" y="437" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"v21: boolean = Less v35, 1000"}
      </text>
      <rect
        x="400"
        y="362"
        width="312"
        height="84"
        rx="6"
        fill="currentColor"
        fillOpacity="0.04"
        stroke="currentColor"
        strokeWidth="0.8"
      />
      <text x="410" y="381" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"addsd xmm13, xmm0          ; sum +="}
      </text>
      <text x="410" y="395" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"mov   r11d, [r13-0x100000] ; LoopHint: poll"}
      </text>
      <text x="410" y="409" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"inc   ebx"}
      </text>
      <text x="410" y="423" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"cmp   ebx, 1000"}
      </text>
      <text x="410" y="437" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"jb    loop"}
      </text>
      <path
        d="M120 118 L120 140.4"
        fill="none"
        stroke="#16a34a"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M120 146 L117.1 139.6 L122.9 139.6 Z" fill="#16a34a" />
      <text x="128" y="136" fontSize="10" fill="#16a34a" fontWeight="600">
        {"passes"}
      </text>
      <path
        d="M28 100 L10 100 L10 307 L22.4 307"
        fill="none"
        stroke="#8b5cf6"
        strokeWidth="1.3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M28 307 L21.6 309.9 L21.6 304.1 Z" fill="#8b5cf6" />
      <text x="16" y="270" fontSize="10" fill="#8b5cf6" fontWeight="600">
        {"fails"}
      </text>
      <path
        d="M372 200 L386 200 L386 400 L377.6 400"
        fill="none"
        stroke="#16a34a"
        strokeWidth="1.3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M372 400 L378.4 397.1 L378.4 402.9 Z" fill="#16a34a" />
      <path
        d="M120 334 L120 356.4"
        fill="none"
        stroke="#8b5cf6"
        strokeWidth="1.3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M120 362 L117.1 355.6 L122.9 355.6 Z" fill="#8b5cf6" />
      <text x="28" y="470" fontSize="10.5" fontStyle="italic">
        {"Offset 12 of every compiled object is its shape word. Offsets 16 and 24 are the slots of y and x."}
      </text>
      <text x="28" y="487" fontSize="10.5" fontStyle="italic">
        {"r13 holds the instance: the state of the program on this thread, with the masks that the tests need."}
      </text>
    </svg>
  </div>
);

export const GenericVersion = () => (
  <div
    style={{
      overflowX: "auto",
      padding: "0 20px",
      WebkitMaskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
      maskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
    }}
  >
    <svg
      viewBox="0 0 720 330"
      width="100%"
      style={{ minWidth: "680px" }}
      fill="currentColor"
      fontFamily="ui-sans-serif, system-ui, sans-serif"
      role="img"
      aria-label="A check in the middle of a function: the failing edge enters a copy of the rest of the function, which comes back where every live value fits its type again"
    >
      <text x="150" y="22" fontSize="12.5" fill="#16a34a" textAnchor="middle" fontWeight="600">
        {"typed code"}
      </text>
      <text x="560" y="22" fontSize="12.5" fill="#8b5cf6" textAnchor="middle" fontWeight="600">
        {"generic version"}
      </text>
      <text x="560" y="38" fontSize="10.5" textAnchor="middle" fillOpacity="0.85">
        {"a copy of all that can run behind a check"}
      </text>
      <rect
        x="30"
        y="36"
        width="240"
        height="36"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.08"
        stroke="#16a34a"
        strokeWidth="1.2"
      />
      <text x="150" y="58" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" textAnchor="middle">
        {"v2: anything = Call v0"}
      </text>
      <rect
        x="30"
        y="92"
        width="240"
        height="36"
        rx="6"
        fill="#d97706"
        fillOpacity="0.08"
        stroke="#d97706"
        strokeWidth="1.2"
      />
      <text x="150" y="114" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" textAnchor="middle">
        {"TypeTest v2 testedType=number"}
      </text>
      <rect
        x="30"
        y="148"
        width="240"
        height="36"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.08"
        stroke="#16a34a"
        strokeWidth="1.2"
      />
      <text x="150" y="170" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" textAnchor="middle">
        {"v4: number = Add v2, v1"}
      </text>
      <rect
        x="30"
        y="204"
        width="240"
        height="36"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.08"
        stroke="#16a34a"
        strokeWidth="1.2"
      />
      <text x="150" y="226" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" textAnchor="middle">
        {"loop header"}
      </text>
      <rect
        x="30"
        y="260"
        width="240"
        height="36"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.08"
        stroke="#16a34a"
        strokeWidth="1.2"
      />
      <text x="150" y="282" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" textAnchor="middle">
        {"v9: number = Mul v4, v8"}
      </text>
      <path
        d="M150 72 L150 86.4"
        fill="none"
        stroke="#16a34a"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M150 92 L147.1 85.6 L152.9 85.6 Z" fill="#16a34a" />
      <path
        d="M150 128 L150 142.4"
        fill="none"
        stroke="#16a34a"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M150 148 L147.1 141.6 L152.9 141.6 Z" fill="#16a34a" />
      <path
        d="M150 184 L150 198.4"
        fill="none"
        stroke="#16a34a"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M150 204 L147.1 197.6 L152.9 197.6 Z" fill="#16a34a" />
      <path
        d="M150 240 L150 254.4"
        fill="none"
        stroke="#16a34a"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M150 260 L147.1 253.6 L152.9 253.6 Z" fill="#16a34a" />
      <rect
        x="430"
        y="148"
        width="270"
        height="36"
        rx="6"
        fill="#8b5cf6"
        fillOpacity="0.08"
        stroke="#8b5cf6"
        strokeWidth="1.2"
      />
      <text x="565" y="170" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" textAnchor="middle">
        {"v4': number|string|bigint = Add v2, v1"}
      </text>
      <rect
        x="430"
        y="204"
        width="270"
        height="36"
        rx="6"
        fill="#8b5cf6"
        fillOpacity="0.08"
        stroke="#8b5cf6"
        strokeWidth="1.2"
      />
      <text x="565" y="226" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" textAnchor="middle">
        {"loop header'"}
      </text>
      <rect
        x="430"
        y="260"
        width="270"
        height="36"
        rx="6"
        fill="#8b5cf6"
        fillOpacity="0.08"
        stroke="#8b5cf6"
        strokeWidth="1.2"
      />
      <text x="565" y="282" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" textAnchor="middle">
        {"v9': number|bigint = Mul v4', v8"}
      </text>
      <path
        d="M565 184 L565 198.4"
        fill="none"
        stroke="#8b5cf6"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M565 204 L562.1 197.6 L567.9 197.6 Z" fill="#8b5cf6" />
      <path
        d="M565 240 L565 254.4"
        fill="none"
        stroke="#8b5cf6"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M565 260 L562.1 253.6 L567.9 253.6 Z" fill="#8b5cf6" />
      <path
        d="M270 110 L390 110 L390 166 L424.4 166"
        fill="none"
        stroke="#8b5cf6"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M430 166 L423.6 168.9 L423.6 163.1 Z" fill="#8b5cf6" />
      <text x="330" y="103" fontSize="10.5" fill="#8b5cf6" textAnchor="middle" fontWeight="600">
        {"fails"}
      </text>
      <text x="282" y="128" fontSize="10" fontStyle="italic" fillOpacity="0.85">
        {"the call has run and"}
      </text>
      <text x="282" y="142" fontSize="10" fontStyle="italic" fillOpacity="0.85">
        {"is not run again"}
      </text>
      <path
        d="M430 222 L275.6 222"
        fill="none"
        stroke="#16a34a"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray="5 3"
      />
      <path d="M270 222 L276.4 219.1 L276.4 224.9 Z" fill="#16a34a" />
      <text x="350" y="215" fontSize="10" fill="#16a34a" textAnchor="middle" fontWeight="600">
        {"way back: every live"}
      </text>
      <text x="350" y="238" fontSize="10" fill="#16a34a" textAnchor="middle" fontWeight="600">
        {"value fits its type again"}
      </text>
      <text x="16" y="318" fontSize="10.5" fontStyle="italic">
        {"In the copy a check and an assumed type say nothing, so every operation takes its generic form."}
      </text>
    </svg>
  </div>
);

export const OperationJourney = () => (
  <div
    style={{
      overflowX: "auto",
      padding: "0 20px",
      WebkitMaskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
      maskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
    }}
  >
    <svg
      viewBox="0 0 720 452"
      width="100%"
      style={{ minWidth: "680px" }}
      fill="currentColor"
      fontFamily="ui-sans-serif, system-ui, sans-serif"
      role="img"
      aria-label="One property read, b.x, from TypeScript through the four forms of the IR to one x64 instruction"
    >
      <rect x="16" y="14" width="76" height="34" rx="5" fill="#ec4899" fillOpacity="0.14" />
      <text
        x="54"
        y="35"
        fontSize="11"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#ec4899"
        textAnchor="middle"
        fontWeight="600"
      >
        {"source"}
      </text>
      <rect
        x="100"
        y="14"
        width="604"
        height="34"
        rx="6"
        fill="#ec4899"
        fillOpacity="0.05"
        stroke="#ec4899"
        strokeWidth="0.8"
      />
      <text x="110" y="28.5" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fontWeight="600">
        {"b.x"}
      </text>
      <text x="110" y="42" fontSize="10" fillOpacity="0.8">
        {"TypeScript. The checker says: member x of interface Vec, a number"}
      </text>
      <path
        d="M54 48 L54 54"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeOpacity="0.6"
      />
      <path d="M54 58 L52 53.4 L56 53.4 Z" fill="currentColor" fillOpacity="0.6" />
      <rect x="16" y="58" width="76" height="34" rx="5" fill="#ec4899" fillOpacity="0.14" />
      <text
        x="54"
        y="79"
        fontSize="11"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#ec4899"
        textAnchor="middle"
        fontWeight="600"
      >
        {"AsRead"}
      </text>
      <rect
        x="100"
        y="58"
        width="604"
        height="34"
        rx="6"
        fill="#ec4899"
        fillOpacity="0.05"
        stroke="#ec4899"
        strokeWidth="0.8"
      />
      <text x="110" y="72.5" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fontWeight="600">
        {'v3 = PropGet v1 key="x"'}
      </text>
      <text x="110" y="86" fontSize="10" fillOpacity="0.8">
        {"on the wire: a read by name, like any other"}
      </text>
      <path
        d="M54 92 L54 98"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeOpacity="0.6"
      />
      <path d="M54 102 L52 97.4 L56 97.4 Z" fill="currentColor" fillOpacity="0.6" />
      <rect x="16" y="102" width="76" height="34" rx="5" fill="#3b82f6" fillOpacity="0.14" />
      <text
        x="54"
        y="123"
        fontSize="11"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#3b82f6"
        textAnchor="middle"
        fontWeight="600"
      >
        {"AsRead"}
      </text>
      <rect
        x="100"
        y="102"
        width="604"
        height="34"
        rx="6"
        fill="#3b82f6"
        fillOpacity="0.05"
        stroke="#3b82f6"
        strokeWidth="0.8"
      />
      <text x="110" y="116.5" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fontWeight="600">
        {'v3: anything ~ number = PropGet v11 key="x"'}
      </text>
      <text x="110" y="130" fontSize="10" fillOpacity="0.8">
        {"TypeValues: nothing proven, a number expected"}
      </text>
      <path
        d="M54 136 L54 142"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeOpacity="0.6"
      />
      <path d="M54 146 L52 141.4 L56 141.4 Z" fill="currentColor" fillOpacity="0.6" />
      <rect x="16" y="146" width="76" height="34" rx="5" fill="#3b82f6" fillOpacity="0.14" />
      <text
        x="54"
        y="167"
        fontSize="11"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#3b82f6"
        textAnchor="middle"
        fontWeight="600"
      >
        {"Prepared"}
      </text>
      <rect
        x="100"
        y="146"
        width="604"
        height="34"
        rx="6"
        fill="#3b82f6"
        fillOpacity="0.05"
        stroke="#3b82f6"
        strokeWidth="0.8"
      />
      <text x="110" y="160.5" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fontWeight="600">
        {'v3: int = PropGet v11 key="x" accessSite=11'}
      </text>
      <text x="110" y="174" fontSize="10" fillOpacity="0.8">
        {"ApplyFlowResults: every store to x of a Vec is an integer"}
      </text>
      <path
        d="M54 180 L54 186"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeOpacity="0.6"
      />
      <path d="M54 190 L52 185.4 L56 185.4 Z" fill="currentColor" fillOpacity="0.6" />
      <rect x="16" y="190" width="76" height="34" rx="5" fill="#3b82f6" fillOpacity="0.14" />
      <text
        x="54"
        y="211"
        fontSize="11"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#3b82f6"
        textAnchor="middle"
        fontWeight="600"
      >
        {"Prepared"}
      </text>
      <rect
        x="100"
        y="190"
        width="604"
        height="34"
        rx="6"
        fill="#3b82f6"
        fillOpacity="0.05"
        stroke="#3b82f6"
        strokeWidth="0.8"
      />
      <text x="110" y="204.5" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fontWeight="600">
        {'v5: int = GetSlot v4 key="x" receivers=[L0] level=Proven'}
      </text>
      <text x="110" y="218" fontSize="10" fillOpacity="0.8">
        {"ResolveAccesses: the receiver is a proven L0, so it is a slot"}
      </text>
      <path
        d="M54 224 L54 230"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeOpacity="0.6"
      />
      <path d="M54 234 L52 229.4 L56 229.4 Z" fill="currentColor" fillOpacity="0.6" />
      <rect x="16" y="234" width="76" height="34" rx="5" fill="#3b82f6" fillOpacity="0.14" />
      <text
        x="54"
        y="255"
        fontSize="11"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#3b82f6"
        textAnchor="middle"
        fontWeight="600"
      >
        {"Selected"}
      </text>
      <rect
        x="100"
        y="234"
        width="604"
        height="34"
        rx="6"
        fill="#3b82f6"
        fillOpacity="0.05"
        stroke="#3b82f6"
        strokeWidth="0.8"
      />
      <text x="110" y="248.5" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fontWeight="600">
        {'v27: int = GetSlot v26 key="x" receivers=[L0] level=Proven'}
      </text>
      <text x="110" y="262" fontSize="10" fillOpacity="0.8">
        {"Select: after PlanSlots, x has a slot of four bytes"}
      </text>
      <path
        d="M54 268 L54 274"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeOpacity="0.6"
      />
      <path d="M54 278 L52 273.4 L56 273.4 Z" fill="currentColor" fillOpacity="0.6" />
      <rect x="16" y="278" width="76" height="34" rx="5" fill="#3b82f6" fillOpacity="0.14" />
      <text
        x="54"
        y="299"
        fontSize="11"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#3b82f6"
        textAnchor="middle"
        fontWeight="600"
      >
        {"Placed"}
      </text>
      <rect
        x="100"
        y="278"
        width="604"
        height="34"
        rx="6"
        fill="#3b82f6"
        fillOpacity="0.05"
        stroke="#3b82f6"
        strokeWidth="0.8"
      />
      <text x="110" y="292.5" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fontWeight="600">
        {'.. GetSlot v26 key="x" .. fieldAccess=0'}
      </text>
      <text x="110" y="306" fontSize="10" fillOpacity="0.8">
        {"NumberAndEncode: the access has a record, offset 24"}
      </text>
      <path
        d="M54 312 L54 318"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeOpacity="0.6"
      />
      <path d="M54 322 L52 317.4 L56 317.4 Z" fill="currentColor" fillOpacity="0.6" />
      <rect x="16" y="322" width="76" height="34" rx="5" fill="#3b82f6" fillOpacity="0.14" />
      <text
        x="54"
        y="343"
        fontSize="11"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#3b82f6"
        textAnchor="middle"
        fontWeight="600"
      >
        {"Placed"}
      </text>
      <rect
        x="100"
        y="322"
        width="604"
        height="34"
        rx="6"
        fill="#3b82f6"
        fillOpacity="0.05"
        stroke="#3b82f6"
        strokeWidth="0.8"
      />
      <text x="110" y="336.5" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fontWeight="600">
        {"v27: int @Int32 = GetSlot v26 .."}
      </text>
      <text x="110" y="350" fontSize="10" fillOpacity="0.8">
        {"ChooseRepresentations: a raw 32-bit integer, never boxed"}
      </text>
      <path
        d="M54 356 L54 362"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeOpacity="0.6"
      />
      <path d="M54 366 L52 361.4 L56 361.4 Z" fill="currentColor" fillOpacity="0.6" />
      <rect x="16" y="366" width="76" height="34" rx="5" fill="#14b8a6" fillOpacity="0.14" />
      <text
        x="54"
        y="387"
        fontSize="11"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#14b8a6"
        textAnchor="middle"
        fontWeight="600"
      >
        {"B3"}
      </text>
      <rect
        x="100"
        y="366"
        width="604"
        height="34"
        rx="6"
        fill="#14b8a6"
        fillOpacity="0.05"
        stroke="#14b8a6"
        strokeWidth="0.8"
      />
      <text x="110" y="380.5" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fontWeight="600">
        {"Int32 = Load(object, offset = 24)"}
      </text>
      <text x="110" y="394" fontSize="10" fillOpacity="0.8">
        {"an ordinary load, with the heap range of this field"}
      </text>
      <path
        d="M54 400 L54 406"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeOpacity="0.6"
      />
      <path d="M54 410 L52 405.4 L56 405.4 Z" fill="currentColor" fillOpacity="0.6" />
      <rect x="16" y="410" width="76" height="34" rx="5" fill="#14b8a6" fillOpacity="0.14" />
      <text
        x="54"
        y="431"
        fontSize="11"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#14b8a6"
        textAnchor="middle"
        fontWeight="600"
      >
        {"x64"}
      </text>
      <rect
        x="100"
        y="410"
        width="604"
        height="34"
        rx="6"
        fill="#14b8a6"
        fillOpacity="0.05"
        stroke="#14b8a6"
        strokeWidth="0.8"
      />
      <text x="110" y="424.5" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fontWeight="600">
        {"cvtsi2sd xmm1, dword ptr [rax + 0x18]"}
      </text>
      <text x="110" y="438" fontSize="10" fillOpacity="0.8">
        {"Air folds the load into the conversion that uses it"}
      </text>
    </svg>
  </div>
);

export const EffectsExample = () => (
  <div
    style={{
      overflowX: "auto",
      padding: "0 20px",
      WebkitMaskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
      maskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
    }}
  >
    <svg
      viewBox="0 0 720 380"
      width="100%"
      style={{ minWidth: "680px" }}
      fill="currentColor"
      fontFamily="ui-sans-serif, system-ui, sans-serif"
      role="img"
      aria-label="Three reads of one field with a known call and an unknown call between them. The first call writes another field, so the value passes. The second may write anything, so the field is read again"
    >
      <text x="16" y="22" fontSize="11.5" fontWeight="600">
        {"operation"}
      </text>
      <text x="310" y="22" fontSize="11.5" fontWeight="600">
        {"reads"}
      </text>
      <text x="430" y="22" fontSize="11.5" fontWeight="600">
        {"writes"}
      </text>
      <rect
        x="16"
        y="34"
        width="520"
        height="34"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.06"
        stroke="#16a34a"
        strokeWidth="0.9"
      />
      <text x="26" y="55" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {'v2 = GetSlot v0 key="limit"'}
      </text>
      <text x="310" y="55" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fillOpacity="0.9">
        {"limit"}
      </text>
      <text x="430" y="55" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {""}
      </text>
      <rect
        x="16"
        y="78"
        width="520"
        height="34"
        rx="6"
        fill="currentColor"
        fillOpacity="0.06"
        stroke="currentColor"
        strokeWidth="0.9"
      />
      <text x="26" y="99" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {'v3 = GetSlot v0 key="count"'}
      </text>
      <text x="310" y="99" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fillOpacity="0.9">
        {"count"}
      </text>
      <text x="430" y="99" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {""}
      </text>
      <rect
        x="16"
        y="122"
        width="520"
        height="34"
        rx="6"
        fill="#3b82f6"
        fillOpacity="0.06"
        stroke="#3b82f6"
        strokeWidth="0.9"
      />
      <text x="26" y="143" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"v4 = CallDirect v0 function=bump"}
      </text>
      <text x="310" y="143" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fillOpacity="0.9">
        {"count"}
      </text>
      <text
        x="430"
        y="143"
        fontSize="10.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#3b82f6"
        fontWeight="600"
      >
        {"count"}
      </text>
      <rect
        x="16"
        y="166"
        width="520"
        height="34"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.06"
        stroke="#16a34a"
        strokeWidth="0.9"
      />
      <text x="26" y="187" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {'v5 = GetSlot v0 key="limit"'}
      </text>
      <text x="310" y="187" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fillOpacity="0.9">
        {"limit"}
      </text>
      <text x="430" y="187" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {""}
      </text>
      <rect
        x="16"
        y="210"
        width="520"
        height="34"
        rx="6"
        fill="currentColor"
        fillOpacity="0.06"
        stroke="currentColor"
        strokeWidth="0.9"
      />
      <text x="26" y="231" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {'v6 = GetSlot v0 key="count"'}
      </text>
      <text x="310" y="231" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fillOpacity="0.9">
        {"count"}
      </text>
      <text x="430" y="231" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {""}
      </text>
      <rect
        x="16"
        y="254"
        width="520"
        height="34"
        rx="6"
        fill="#ef4444"
        fillOpacity="0.06"
        stroke="#ef4444"
        strokeWidth="0.9"
      />
      <text x="26" y="275" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"v7 = Call v1"}
      </text>
      <text x="310" y="275" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fillOpacity="0.9">
        {"everything"}
      </text>
      <text
        x="430"
        y="275"
        fontSize="10.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#ef4444"
        fontWeight="600"
      >
        {"everything"}
      </text>
      <rect
        x="16"
        y="298"
        width="520"
        height="34"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.06"
        stroke="#16a34a"
        strokeWidth="0.9"
      />
      <text x="26" y="319" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {'v8 = GetSlot v0 key="limit"'}
      </text>
      <text x="310" y="319" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fillOpacity="0.9">
        {"limit"}
      </text>
      <text x="430" y="319" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {""}
      </text>
      <path
        d="M536 51 L580 51 L580 183 L545.6 183"
        fill="none"
        stroke="#16a34a"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M540 183 L546.4 180.1 L546.4 185.9 Z" fill="#16a34a" />
      <path
        d="M591 109 L595 113 L601 105"
        fill="none"
        stroke="#16a34a"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <text x="610" y="107" fontSize="10" fill="#16a34a" fontWeight="600">
        {"bump writes"}
      </text>
      <text x="610" y="120" fontSize="10" fill="#16a34a" fontWeight="600">
        {"count only:"}
      </text>
      <text x="610" y="133" fontSize="10" fill="#16a34a" fontWeight="600">
        {"v5 becomes v2"}
      </text>
      <path
        d="M536 95 L556 95 L556 133"
        fill="none"
        stroke="#ef4444"
        strokeWidth="1.3"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray="4 3"
      />
      <path
        d="M551 134 L561 144"
        fill="none"
        stroke="#ef4444"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M551 144 L561 134"
        fill="none"
        stroke="#ef4444"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M536 191 L580 191 L580 265"
        fill="none"
        stroke="#ef4444"
        strokeWidth="1.3"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray="4 3"
      />
      <path
        d="M575 266 L585 276"
        fill="none"
        stroke="#ef4444"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M575 276 L585 266"
        fill="none"
        stroke="#ef4444"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <text x="610" y="263" fontSize="10" fill="#ef4444" fontWeight="600">
        {"may write"}
      </text>
      <text x="610" y="276" fontSize="10" fill="#ef4444" fontWeight="600">
        {"anything:"}
      </text>
      <text x="610" y="289" fontSize="10" fill="#ef4444" fontWeight="600">
        {"v8 stays a load"}
      </text>
      <text x="16" y="362" fontSize="10.5" fontStyle="italic">
        {
          "count and limit are two locations of the heap ObjectFields[PropertyKey]. A write to one says nothing about the other."
        }
      </text>
    </svg>
  </div>
);

export const SummaryAtCallSite = () => (
  <div
    style={{
      overflowX: "auto",
      padding: "0 20px",
      WebkitMaskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
      maskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
    }}
  >
    <svg
      viewBox="0 0 720 330"
      width="100%"
      style={{ minWidth: "680px" }}
      fill="currentColor"
      fontFamily="ui-sans-serif, system-ui, sans-serif"
      role="img"
      aria-label="The summary of a callee is written in terms of its parameters. The caller substitutes its arguments and keeps every fact that the summary does not touch"
    >
      <rect
        x="16"
        y="16"
        width="300"
        height="150"
        rx="6"
        fill="#3b82f6"
        fillOpacity="0.06"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <text x="30" y="38" fontSize="12" fill="#3b82f6" fontWeight="600">
        {"summary of move(p, by)"}
      </text>
      <text x="30" y="60" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"p0   [Inspects]  writes ObjectFields[x]"}
      </text>
      <text x="30" y="79" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"p1   [Inspects]  reads  ObjectFields[x]"}
      </text>
      <text x="30" y="98" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"elsewhere        nothing"}
      </text>
      <text x="30" y="117" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"returns          undefined"}
      </text>
      <text x="30" y="136" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"throws, collects, unknown code: no"}
      </text>
      <rect
        x="16"
        y="196"
        width="300"
        height="56"
        rx="6"
        fill="#ec4899"
        fillOpacity="0.06"
        stroke="#ec4899"
        strokeWidth="1.2"
      />
      <text x="30" y="218" fontSize="12" fill="#ec4899" fontWeight="600">
        {"call site"}
      </text>
      <text x="30" y="239" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"CallDirect a, step  function=move"}
      </text>
      <path
        d="M60 166 L60 190.4"
        fill="none"
        stroke="#3b82f6"
        strokeWidth="1.3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M60 196 L57.1 189.6 L62.9 189.6 Z" fill="#3b82f6" />
      <text
        x="74"
        y="186"
        fontSize="10.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#3b82f6"
        fontWeight="600"
      >
        {"p0 := a,  p1 := step"}
      </text>
      <path
        d="M316 150 L366.4 150"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M372 150 L365.6 152.9 L365.6 147.1 Z" fill="currentColor" />
      <text x="388" y="32" fontSize="12" fontWeight="600">
        {"what the caller knew, after the call"}
      </text>
      <rect
        x="388"
        y="48"
        width="316"
        height="32"
        rx="6"
        fill="#ef4444"
        fillOpacity="0.06"
        stroke="#ef4444"
        strokeWidth="0.8"
      />
      <path
        d="M399.5 59.5 L408.5 68.5"
        fill="none"
        stroke="#ef4444"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M399.5 68.5 L408.5 59.5"
        fill="none"
        stroke="#ef4444"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <text x="420" y="62" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fontWeight="600">
        {"a.x = 3"}
      </text>
      <text x="420" y="74.5" fontSize="9.5" fillOpacity="0.8">
        {"written through p0"}
      </text>
      <rect
        x="388"
        y="85"
        width="316"
        height="32"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.06"
        stroke="#16a34a"
        strokeWidth="0.8"
      />
      <path
        d="M399.5 101 L403.1 104.6 L408.5 97.4"
        fill="none"
        stroke="#16a34a"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <text x="420" y="99" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fontWeight="600">
        {"a.y = 4"}
      </text>
      <text x="420" y="111.5" fontSize="9.5" fillOpacity="0.8">
        {"another key"}
      </text>
      <rect
        x="388"
        y="122"
        width="316"
        height="32"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.06"
        stroke="#16a34a"
        strokeWidth="0.8"
      />
      <path
        d="M399.5 138 L403.1 141.6 L408.5 134.4"
        fill="none"
        stroke="#16a34a"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <text x="420" y="136" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fontWeight="600">
        {"a is not frozen"}
      </text>
      <text x="420" y="148.5" fontSize="9.5" fillOpacity="0.8">
        {"no write to the order words"}
      </text>
      <rect
        x="388"
        y="159"
        width="316"
        height="32"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.06"
        stroke="#16a34a"
        strokeWidth="0.8"
      />
      <path
        d="M399.5 175 L403.1 178.6 L408.5 171.4"
        fill="none"
        stroke="#16a34a"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <text x="420" y="173" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fontWeight="600">
        {"step.x = 1"}
      </text>
      <text x="420" y="185.5" fontSize="9.5" fillOpacity="0.8">
        {"only read. step is not a: proven apart"}
      </text>
      <rect
        x="388"
        y="196"
        width="316"
        height="32"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.06"
        stroke="#16a34a"
        strokeWidth="0.8"
      />
      <path
        d="M399.5 212 L403.1 215.6 L408.5 208.4"
        fill="none"
        stroke="#16a34a"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <text x="420" y="210" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fontWeight="600">
        {"c.x = 9"}
      </text>
      <text x="420" y="222.5" fontSize="9.5" fillOpacity="0.8">
        {"c was not passed, elsewhere is empty"}
      </text>
      <rect
        x="388"
        y="233"
        width="316"
        height="32"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.06"
        stroke="#16a34a"
        strokeWidth="0.8"
      />
      <path
        d="M399.5 249 L403.1 252.6 L408.5 245.4"
        fill="none"
        stroke="#16a34a"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <text x="420" y="247" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fontWeight="600">
        {"list[0] is in bounds"}
      </text>
      <text x="420" y="259.5" fontSize="9.5" fillOpacity="0.8">
        {"no write to ArrayStorage"}
      </text>
      <rect
        x="388"
        y="270"
        width="316"
        height="32"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.06"
        stroke="#16a34a"
        strokeWidth="0.8"
      />
      <path
        d="M399.5 286 L403.1 289.6 L408.5 282.4"
        fill="none"
        stroke="#16a34a"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <text x="420" y="284" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fontWeight="600">
        {"a has not escaped"}
      </text>
      <text x="420" y="296.5" fontSize="9.5" fillOpacity="0.8">
        {"Inspects: neither kept nor returned"}
      </text>
      <text x="16" y="290" fontSize="10.5" fontStyle="italic">
        {"Without the summary, the call would count as unknown code"}
      </text>
      <text x="16" y="306" fontSize="10.5" fontStyle="italic">
        {"and every line on the right would be in doubt."}
      </text>
    </svg>
  </div>
);

export const BuiltinCall = () => (
  <div
    style={{
      overflowX: "auto",
      padding: "0 20px",
      WebkitMaskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
      maskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
    }}
  >
    <svg
      viewBox="0 0 720 436"
      width="100%"
      style={{ minWidth: "680px" }}
      fill="currentColor"
      fontFamily="ui-sans-serif, system-ui, sans-serif"
      role="img"
      aria-label="How list.push(x) becomes inline code: bind, prove the callee, pick an overload, simplify, implement. Each step has a fallback"
    >
      <rect
        x="16"
        y="12"
        width="470"
        height="82"
        rx="6"
        fill="#ec4899"
        fillOpacity="0.06"
        stroke="#ec4899"
        strokeWidth="1.2"
      />
      <text x="28" y="30" fontSize="11.5" fill="#ec4899" fontWeight="600">
        {"1  bind"}
      </text>
      <text x="476" y="30" fontSize="9.5" textAnchor="end" fillOpacity="0.8">
        {"the checker binds push to Array<T>.push in its library"}
      </text>
      <text x="28" y="48" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {'v5 = PropGet list key="push"'}
      </text>
      <text x="28" y="62" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"v6 = Convert v5 builtin(ArrayPrototypePush) [IsExpected]"}
      </text>
      <text x="28" y="76" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {'v7 = Call v6, list, x calleeKey="push"'}
      </text>
      <rect
        x="520"
        y="18"
        width="184"
        height="70"
        rx="6"
        fill="#8b5cf6"
        fillOpacity="0.05"
        stroke="#8b5cf6"
        strokeWidth="0.8"
        strokeDasharray="4 3"
      />
      <text x="530" y="50" fontSize="9.5">
        {"not the global Array type: an"}
      </text>
      <text x="530" y="63" fontSize="9.5">
        {"ordinary call"}
      </text>
      <path
        d="M486 53 L516 53"
        fill="none"
        stroke="#8b5cf6"
        strokeWidth="1.1"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray="4 3"
      />
      <path d="M520 53 L515.4 55 L515.4 51 Z" fill="#8b5cf6" />
      <path
        d="M250 94 L250 103.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M250 108 L247.8 103 L252.2 103 Z" fill="currentColor" />
      <rect
        x="16"
        y="108"
        width="470"
        height="68"
        rx="6"
        fill="#3b82f6"
        fillOpacity="0.06"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <text x="28" y="126" fontSize="11.5" fill="#3b82f6" fontWeight="600">
        {"2  prove the callee"}
      </text>
      <text x="476" y="126" fontSize="9.5" textAnchor="end" fillOpacity="0.8">
        {"no own push, prototype unchanged, member original"}
      </text>
      <text x="28" y="144" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"list: Array<number, pristine[Storage, Names]>"}
      </text>
      <text x="28" y="158" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"Array.prototype.push: locked"}
      </text>
      <rect
        x="520"
        y="114"
        width="184"
        height="56"
        rx="6"
        fill="#8b5cf6"
        fillOpacity="0.05"
        stroke="#8b5cf6"
        strokeWidth="0.8"
        strokeDasharray="4 3"
      />
      <text x="530" y="139" fontSize="9.5">
        {"unproven: IsPristine test, or"}
      </text>
      <text x="530" y="152" fontSize="9.5">
        {"a test of the callee"}
      </text>
      <path
        d="M486 142 L516 142"
        fill="none"
        stroke="#8b5cf6"
        strokeWidth="1.1"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray="4 3"
      />
      <path d="M520 142 L515.4 144 L515.4 140 Z" fill="#8b5cf6" />
      <path
        d="M250 176 L250 185.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M250 190 L247.8 185 L252.2 185 Z" fill="currentColor" />
      <rect
        x="16"
        y="190"
        width="470"
        height="82"
        rx="6"
        fill="#3b82f6"
        fillOpacity="0.06"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <text x="28" y="208" fontSize="11.5" fill="#3b82f6" fontWeight="600">
        {"3  pick the overload"}
      </text>
      <text x="476" y="208" fontSize="9.5" textAnchor="end" fillOpacity="0.8">
        {"decision tree over operand types, from the table"}
      </text>
      <text x="28" y="226" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"v7 = CallBuiltin list, x overload=ArrayPrototypePush/0"}
      </text>
      <text x="28" y="240" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"effects: GrowsArray. No user code runs, x is kept in list only"}
      </text>
      <text x="28" y="254" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"result:  int[0, 4294967295]"}
      </text>
      <rect
        x="520"
        y="196"
        width="184"
        height="70"
        rx="6"
        fill="#8b5cf6"
        fillOpacity="0.05"
        stroke="#8b5cf6"
        strokeWidth="0.8"
        strokeDasharray="4 3"
      />
      <text x="530" y="228" fontSize="9.5">
        {"array-like receiver: overload"}
      </text>
      <text x="530" y="241" fontSize="9.5">
        {"/1, may run setters"}
      </text>
      <path
        d="M486 231 L516 231"
        fill="none"
        stroke="#8b5cf6"
        strokeWidth="1.1"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray="4 3"
      />
      <path d="M520 231 L515.4 233 L515.4 229 Z" fill="#8b5cf6" />
      <path
        d="M250 272 L250 281.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M250 286 L247.8 281 L252.2 281 Z" fill="currentColor" />
      <rect
        x="16"
        y="286"
        width="470"
        height="54"
        rx="6"
        fill="#3b82f6"
        fillOpacity="0.06"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <text x="28" y="304" fontSize="11.5" fill="#3b82f6" fontWeight="600">
        {"4  simplify"}
      </text>
      <text x="476" y="304" fontSize="9.5" textAnchor="end" fillOpacity="0.8">
        {"identities, per built-in. None applies to push"}
      </text>
      <text x="28" y="322" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"Array.isArray(list) -> true     s.charCodeAt(i) -> a code unit read"}
      </text>
      <path
        d="M250 340 L250 349.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M250 354 L247.8 349 L252.2 349 Z" fill="currentColor" />
      <rect
        x="16"
        y="354"
        width="470"
        height="54"
        rx="6"
        fill="#14b8a6"
        fillOpacity="0.06"
        stroke="#14b8a6"
        strokeWidth="1.2"
      />
      <text x="28" y="372" fontSize="11.5" fill="#14b8a6" fontWeight="600">
        {"5  implement"}
      </text>
      <text x="476" y="372" fontSize="9.5" textAnchor="end" fillOpacity="0.8">
        {"store, bump the length. No room: the stub ArrayPush"}
      </text>
      <text x="28" y="390" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"v7 = CallInline list, x inlineBuiltin=ArrayPush"}
      </text>
      <rect
        x="520"
        y="360"
        width="184"
        height="42"
        rx="6"
        fill="#8b5cf6"
        fillOpacity="0.05"
        stroke="#8b5cf6"
        strokeWidth="0.8"
        strokeDasharray="4 3"
      />
      <text x="530" y="378" fontSize="9.5">
        {"no inline form: a call of the"}
      </text>
      <text x="530" y="391" fontSize="9.5">
        {"native function"}
      </text>
      <path
        d="M486 381 L516 381"
        fill="none"
        stroke="#8b5cf6"
        strokeWidth="1.1"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray="4 3"
      />
      <path d="M520 381 L515.4 383 L515.4 379 Z" fill="#8b5cf6" />
      <text x="612" y="420" fontSize="10" fill="#8b5cf6" textAnchor="middle" fontStyle="italic">
        {"otherwise"}
      </text>
    </svg>
  </div>
);

export const ValueFlow = () => (
  <div
    style={{
      overflowX: "auto",
      padding: "0 20px",
      WebkitMaskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
      maskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
    }}
  >
    <svg
      viewBox="0 0 720 400"
      width="100%"
      style={{ minWidth: "680px" }}
      fill="currentColor"
      fontFamily="ui-sans-serif, system-ui, sans-serif"
      role="img"
      aria-label="A value flow graph. Two allocation sites reach the parameter of a function. One object is also handed to unknown code and escapes. The other keeps its proofs"
    >
      <text x="16" y="22" fontSize="11.5" fontWeight="600">
        {"allocation sites"}
      </text>
      <text x="250" y="22" fontSize="11.5" fontWeight="600">
        {"positions"}
      </text>
      <text x="520" y="22" fontSize="11.5" fontWeight="600">
        {"uses"}
      </text>
      <rect
        x="16"
        y="40"
        width="180"
        height="44"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.08"
        stroke="#16a34a"
        strokeWidth="1.2"
      />
      <text
        x="106"
        y="59"
        fontSize="10.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fontWeight="600"
      >
        {"A: { x: 1, y: 0.5 }"}
      </text>
      <text x="106" y="74" fontSize="9.5" textAnchor="middle" fillOpacity="0.8">
        {"dot.ts:10, layout L0"}
      </text>
      <rect
        x="16"
        y="110"
        width="180"
        height="44"
        rx="6"
        fill="#d97706"
        fillOpacity="0.08"
        stroke="#d97706"
        strokeWidth="1.2"
      />
      <text
        x="106"
        y="129"
        fontSize="10.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fontWeight="600"
      >
        {"B: { x: 2, y: 2 }"}
      </text>
      <text x="106" y="144" fontSize="9.5" textAnchor="middle" fillOpacity="0.8">
        {"layout L0 too"}
      </text>
      <rect
        x="16"
        y="250"
        width="180"
        height="44"
        rx="6"
        fill="#ef4444"
        fillOpacity="0.08"
        stroke="#ef4444"
        strokeWidth="1.2"
      />
      <text
        x="106"
        y="269"
        fontSize="10.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fontWeight="600"
      >
        {"U: the unknown object"}
      </text>
      <text x="106" y="284" fontSize="9.5" textAnchor="middle" fillOpacity="0.8">
        {"JSON.parse, unseen code"}
      </text>
      <rect
        x="250"
        y="40"
        width="170"
        height="44"
        rx="22"
        fill="#3b82f6"
        fillOpacity="0.06"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <text
        x="335"
        y="59"
        fontSize="10.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fontWeight="600"
      >
        {"variable unit"}
      </text>
      <text
        x="335"
        y="74"
        fontSize="9.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fillOpacity="0.85"
      >
        {"{ A }"}
      </text>
      <rect
        x="250"
        y="110"
        width="170"
        height="44"
        rx="22"
        fill="#3b82f6"
        fillOpacity="0.06"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <text
        x="335"
        y="129"
        fontSize="10.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fontWeight="600"
      >
        {"variable other"}
      </text>
      <text
        x="335"
        y="144"
        fontSize="9.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fillOpacity="0.85"
      >
        {"{ B }"}
      </text>
      <rect
        x="250"
        y="180"
        width="170"
        height="44"
        rx="22"
        fill="#3b82f6"
        fillOpacity="0.06"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <text
        x="335"
        y="199"
        fontSize="10.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fontWeight="600"
      >
        {"parameter a of dot"}
      </text>
      <text
        x="335"
        y="214"
        fontSize="9.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fillOpacity="0.85"
      >
        {"{ A, B }"}
      </text>
      <rect
        x="250"
        y="250"
        width="170"
        height="44"
        rx="22"
        fill="#ef4444"
        fillOpacity="0.06"
        stroke="#ef4444"
        strokeWidth="1.2"
      />
      <text
        x="335"
        y="269"
        fontSize="10.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fontWeight="600"
      >
        {"parameter b of dot"}
      </text>
      <text
        x="335"
        y="284"
        fontSize="9.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fillOpacity="0.85"
      >
        {"{ U }"}
      </text>
      <path
        d="M196 62 L244.4 62"
        fill="none"
        stroke="#16a34a"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M250 62 L243.6 64.9 L243.6 59.1 Z" fill="#16a34a" />
      <path
        d="M196 132 L244.4 132"
        fill="none"
        stroke="#d97706"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M250 132 L243.6 134.9 L243.6 129.1 Z" fill="#d97706" />
      <path
        d="M196 272 L244.4 272"
        fill="none"
        stroke="#ef4444"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M250 272 L243.6 274.9 L243.6 269.1 Z" fill="#ef4444" />
      <path
        d="M420 62 L446 62 L446 194 L425.6 194"
        fill="none"
        stroke="#16a34a"
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M420 194 L426.4 191.1 L426.4 196.9 Z" fill="#16a34a" />
      <path
        d="M420 132 L436 132 L436 206 L425.6 206"
        fill="none"
        stroke="#d97706"
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M420 206 L426.4 203.1 L426.4 208.9 Z" fill="#d97706" />
      <rect
        x="520"
        y="172"
        width="184"
        height="60"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.07"
        stroke="#16a34a"
        strokeWidth="1.2"
      />
      <text
        x="612"
        y="192"
        fontSize="11"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fontWeight="600"
      >
        {"a.x"}
      </text>
      <text x="612" y="208" fontSize="9.5" textAnchor="middle">
        {"receivers = [L0]: a slot"}
      </text>
      <text x="612" y="222" fontSize="9.5" textAnchor="middle">
        {"the entry check is answered"}
      </text>
      <path
        d="M420 200 L514.4 200"
        fill="none"
        stroke="#3b82f6"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M520 200 L513.6 202.9 L513.6 197.1 Z" fill="#3b82f6" />
      <rect
        x="520"
        y="244"
        width="184"
        height="56"
        rx="6"
        fill="#d97706"
        fillOpacity="0.07"
        stroke="#d97706"
        strokeWidth="1.2"
      />
      <text
        x="612"
        y="264"
        fontSize="11"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fontWeight="600"
      >
        {"b.x"}
      </text>
      <text x="612" y="280" fontSize="9.5" textAnchor="middle">
        {"nothing proven: the check stays"}
      </text>
      <text x="612" y="293" fontSize="9.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" textAnchor="middle">
        {"cause: DataFromOutside"}
      </text>
      <path
        d="M420 272 L514.4 272"
        fill="none"
        stroke="#ef4444"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M520 272 L513.6 274.9 L513.6 269.1 Z" fill="#ef4444" />
      <rect
        x="520"
        y="96"
        width="184"
        height="60"
        rx="6"
        fill="#ef4444"
        fillOpacity="0.06"
        stroke="#ef4444"
        strokeWidth="1.2"
        strokeDasharray="4 3"
      />
      <text
        x="612"
        y="116"
        fontSize="10.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fontWeight="600"
      >
        {"undescribed(other)"}
      </text>
      <text x="612" y="132" fontSize="9.5" textAnchor="middle">
        {"B escapes: unknown code"}
      </text>
      <text x="612" y="145" fontSize="9.5" textAnchor="middle">
        {"may read what it holds"}
      </text>
      <path
        d="M420 124 L514.4 124"
        fill="none"
        stroke="#ef4444"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray="4 3"
      />
      <path d="M520 124 L513.6 126.9 L513.6 121.1 Z" fill="#ef4444" />
      <text x="16" y="336" fontSize="10.5" fontStyle="italic">
        {"A and B are told apart. Only B has escaped, and only what can be reached from B is in unknown hands."}
      </text>
      <text x="16" y="353" fontSize="10.5" fontStyle="italic">
        {"What arrives is a loss per position: b.x is slow and a.x is not."}
      </text>
      <text x="16" y="370" fontSize="10.5" fontStyle="italic">
        {
          "What is done to an object (a delete, a redefinition, a store of another type) is recorded per layout, for all its objects."
        }
      </text>
    </svg>
  </div>
);

export const ObjectLayout = () => (
  <div
    style={{
      overflowX: "auto",
      padding: "0 20px",
      WebkitMaskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
      maskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
    }}
  >
    <svg
      viewBox="0 0 720 420"
      width="100%"
      style={{ minWidth: "680px" }}
      fill="currentColor"
      fontFamily="ui-sans-serif, system-ui, sans-serif"
      role="img"
      aria-label="The memory of a compiled object: an eight-byte cell header, an order word, a shape word, then typed slots. Extra properties live in a side object"
    >
      <text x="40" y="24" fontSize="12.5" fontWeight="600">
        {"a Vec, { x: 1, y: 0.5 }"}
      </text>
      <text x="260" y="24" fontSize="10.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fillOpacity="0.8">
        {"AOT::Object, layout L0, shape number 1"}
      </text>
      <rect
        x="40"
        y="58"
        width="80"
        height="52"
        rx="2"
        fill="currentColor"
        fillOpacity="0.09"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <text x="80" y="88" fontSize="9.5" textAnchor="middle" fontWeight="600">
        {"StructureID"}
      </text>
      <text x="40" y="52" fontSize="9.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fillOpacity="0.7">
        {"0"}
      </text>
      <rect
        x="120"
        y="58"
        width="80"
        height="52"
        rx="2"
        fill="currentColor"
        fillOpacity="0.09"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <text x="160" y="88" fontSize="9.5" textAnchor="middle" fontWeight="600">
        {"type, flags"}
      </text>
      <text x="120" y="52" fontSize="9.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fillOpacity="0.7">
        {"4"}
      </text>
      <rect
        x="200"
        y="58"
        width="80"
        height="52"
        rx="2"
        fill="#d97706"
        fillOpacity="0.09"
        stroke="#d97706"
        strokeWidth="1.2"
      />
      <text x="240" y="88" fontSize="9.5" textAnchor="middle" fontWeight="600">
        {"order word"}
      </text>
      <text x="200" y="52" fontSize="9.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fillOpacity="0.7">
        {"8"}
      </text>
      <rect
        x="280"
        y="58"
        width="80"
        height="52"
        rx="2"
        fill="#16a34a"
        fillOpacity="0.09"
        stroke="#16a34a"
        strokeWidth="1.2"
      />
      <text x="320" y="80" fontSize="9.5" textAnchor="middle" fontWeight="600">
        {"shape word"}
      </text>
      <text
        x="320"
        y="97"
        fontSize="8.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fillOpacity="0.85"
      >
        {"0xffffffff = -1"}
      </text>
      <text x="280" y="52" fontSize="9.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fillOpacity="0.7">
        {"12"}
      </text>
      <rect
        x="360"
        y="58"
        width="160"
        height="52"
        rx="2"
        fill="#3b82f6"
        fillOpacity="0.09"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <text x="440" y="80" fontSize="11" textAnchor="middle" fontWeight="600">
        {"y: Double"}
      </text>
      <text
        x="440"
        y="97"
        fontSize="10"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fillOpacity="0.85"
      >
        {"0.5, raw"}
      </text>
      <text x="360" y="52" fontSize="9.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fillOpacity="0.7">
        {"16"}
      </text>
      <rect
        x="520"
        y="58"
        width="80"
        height="52"
        rx="2"
        fill="#3b82f6"
        fillOpacity="0.09"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <text x="560" y="80" fontSize="9.5" textAnchor="middle" fontWeight="600">
        {"x: Int32"}
      </text>
      <text
        x="560"
        y="97"
        fontSize="8.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fillOpacity="0.85"
      >
        {"1, raw"}
      </text>
      <text x="520" y="52" fontSize="9.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fillOpacity="0.7">
        {"24"}
      </text>
      <rect
        x="600"
        y="58"
        width="80"
        height="52"
        rx="2"
        fill="currentColor"
        fillOpacity="0.03"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeDasharray="3 3"
      />
      <text x="640" y="88" fontSize="9.5" textAnchor="middle" fontWeight="600">
        {"unused"}
      </text>
      <text x="600" y="52" fontSize="9.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" fillOpacity="0.7">
        {"28"}
      </text>
      <text
        x="680"
        y="52"
        fontSize="9.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="end"
        fillOpacity="0.7"
      >
        {"32"}
      </text>
      <path
        d="M40 118 L40 124 L198 124 L198 118"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeOpacity="0.6"
      />
      <text x="120" y="138" fontSize="9.5" textAnchor="middle" fillOpacity="0.85">
        {"JSCell, as in every cell of the engine"}
      </text>
      <path
        d="M240 110 L240 162.4"
        fill="none"
        stroke="#d97706"
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M240 168 L237.1 161.6 L242.9 161.6 Z" fill="#d97706" />
      <text x="40" y="164" fontSize="11.5" fill="#d97706" fontWeight="600">
        {"order word"}
      </text>
      <rect
        x="40"
        y="174"
        width="187.5"
        height="34"
        rx="2"
        fill="#d97706"
        fillOpacity="0.08"
        stroke="#d97706"
        strokeWidth="1.2"
      />
      <text x="133.8" y="190" fontSize="10" textAnchor="middle" fontWeight="600">
        {"key order"}
      </text>
      <text
        x="133.8"
        y="203"
        fontSize="8.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fillOpacity="0.75"
      >
        {"0 .. 14"}
      </text>
      <rect
        x="227.5"
        y="174"
        width="150"
        height="34"
        rx="2"
        fill="#d97706"
        fillOpacity="0.08"
        stroke="#d97706"
        strokeWidth="1.2"
      />
      <text x="302.5" y="190" fontSize="10" textAnchor="middle" fontWeight="600">
        {"fields so far"}
      </text>
      <text
        x="302.5"
        y="203"
        fontSize="8.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fillOpacity="0.75"
      >
        {"15 .. 26"}
      </text>
      <rect
        x="377.5"
        y="174"
        width="34"
        height="34"
        rx="2"
        fill="#d97706"
        fillOpacity="0.08"
        stroke="#d97706"
        strokeWidth="1.2"
      />
      <text x="394.5" y="190" fontSize="10" textAnchor="middle" fontWeight="600">
        {"O"}
      </text>
      <text
        x="394.5"
        y="203"
        fontSize="8.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fillOpacity="0.75"
      >
        {"27"}
      </text>
      <rect
        x="411.5"
        y="174"
        width="34"
        height="34"
        rx="2"
        fill="#d97706"
        fillOpacity="0.08"
        stroke="#d97706"
        strokeWidth="1.2"
      />
      <text x="428.5" y="190" fontSize="10" textAnchor="middle" fontWeight="600">
        {"E"}
      </text>
      <text
        x="428.5"
        y="203"
        fontSize="8.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fillOpacity="0.75"
      >
        {"28"}
      </text>
      <rect
        x="445.5"
        y="174"
        width="34"
        height="34"
        rx="2"
        fill="#d97706"
        fillOpacity="0.08"
        stroke="#d97706"
        strokeWidth="1.2"
      />
      <text x="462.5" y="190" fontSize="10" textAnchor="middle" fontWeight="600">
        {"F"}
      </text>
      <text
        x="462.5"
        y="203"
        fontSize="8.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fillOpacity="0.75"
      >
        {"29"}
      </text>
      <rect
        x="479.5"
        y="174"
        width="34"
        height="34"
        rx="2"
        fill="#d97706"
        fillOpacity="0.08"
        stroke="#d97706"
        strokeWidth="1.2"
      />
      <text x="496.5" y="190" fontSize="10" textAnchor="middle" fontWeight="600">
        {"S"}
      </text>
      <text
        x="496.5"
        y="203"
        fontSize="8.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fillOpacity="0.75"
      >
        {"30"}
      </text>
      <rect
        x="513.5"
        y="174"
        width="34"
        height="34"
        rx="2"
        fill="#d97706"
        fillOpacity="0.08"
        stroke="#d97706"
        strokeWidth="1.2"
      />
      <text x="530.5" y="190" fontSize="10" textAnchor="middle" fontWeight="600">
        {"N"}
      </text>
      <text
        x="530.5"
        y="203"
        fontSize="8.5"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="middle"
        fillOpacity="0.75"
      >
        {"31"}
      </text>
      <text x="560" y="180" fontSize="9.5">
        {"O  a field lies outside its slot"}
      </text>
      <text x="560" y="193" fontSize="9.5">
        {"E  has extra properties"}
      </text>
      <text x="560" y="206" fontSize="9.5">
        {"F S N  frozen, sealed,"}
      </text>
      <text x="560" y="218" fontSize="9.5">
        {"not extensible"}
      </text>
      <path
        d="M320 110 L320 132 L338.4 132"
        fill="none"
        stroke="#16a34a"
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M344 132 L337.6 134.9 L337.6 129.1 Z" fill="#16a34a" />
      <text
        x="350"
        y="128"
        fontSize="10"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#16a34a"
        fontWeight="600"
      >
        {"cmp dword [obj+12], -1"}
      </text>
      <text x="350" y="142" fontSize="9.5" fill="#16a34a">
        {'the whole test for "is a Vec", once obj is known to be a cell'}
      </text>
      <text x="40" y="250" fontSize="12" fontFamily="ui-monospace, Menlo, Consolas, monospace" fontWeight="600">
        {'after  (v as any).x = "one";  (v as any).z = 5'}
      </text>
      <rect
        x="40"
        y="264"
        width="104"
        height="36"
        rx="2"
        fill="currentColor"
        fillOpacity="0.09"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <text x="92" y="286" fontSize="9" textAnchor="middle" fontWeight="600">
        {"JSCell"}
      </text>
      <rect
        x="144"
        y="264"
        width="52"
        height="36"
        rx="2"
        fill="#d97706"
        fillOpacity="0.09"
        stroke="#d97706"
        strokeWidth="1.2"
      />
      <text x="170" y="286" fontSize="9" textAnchor="middle" fontWeight="600">
        {"O E set"}
      </text>
      <rect
        x="196"
        y="264"
        width="52"
        height="36"
        rx="2"
        fill="#16a34a"
        fillOpacity="0.09"
        stroke="#16a34a"
        strokeWidth="1.2"
      />
      <text x="222" y="286" fontSize="9" textAnchor="middle" fontWeight="600">
        {"-1"}
      </text>
      <rect
        x="248"
        y="264"
        width="104"
        height="36"
        rx="2"
        fill="#3b82f6"
        fillOpacity="0.09"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <text x="300" y="286" fontSize="9" textAnchor="middle" fontWeight="600">
        {"y: 0.5"}
      </text>
      <rect
        x="352"
        y="264"
        width="52"
        height="36"
        rx="2"
        fill="#ef4444"
        fillOpacity="0.09"
        stroke="#ef4444"
        strokeWidth="1.2"
      />
      <text x="378" y="286" fontSize="9" textAnchor="middle" fontWeight="600">
        {"x: absent"}
      </text>
      <rect
        x="404"
        y="264"
        width="52"
        height="36"
        rx="2"
        fill="#8b5cf6"
        fillOpacity="0.09"
        stroke="#8b5cf6"
        strokeWidth="1.2"
      />
      <text x="430" y="286" fontSize="9" textAnchor="middle" fontWeight="600">
        {"extras"}
      </text>
      <path
        d="M430 300 L430 322 L494.4 322"
        fill="none"
        stroke="#8b5cf6"
        strokeWidth="1.3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M500 322 L493.6 324.9 L493.6 319.1 Z" fill="#8b5cf6" />
      <rect
        x="500"
        y="264"
        width="204"
        height="84"
        rx="6"
        fill="#8b5cf6"
        fillOpacity="0.07"
        stroke="#8b5cf6"
        strokeWidth="1.2"
      />
      <text x="602" y="284" fontSize="10.5" fill="#8b5cf6" textAnchor="middle" fontWeight="600">
        {"an ordinary JSObject"}
      </text>
      <text x="520" y="304" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {'x: "one"     boxed'}
      </text>
      <text x="520" y="319" fontSize="10" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"z: 5         boxed"}
      </text>
      <text x="602" y="340" fontSize="9.5" textAnchor="middle" fillOpacity="0.8">
        {"found by name"}
      </text>
      <text x="40" y="330" fontSize="10.5" fontStyle="italic">
        {"The shape word stays: the object is a Vec for life."}
      </text>
      <text x="40" y="346" fontSize="10.5" fontStyle="italic">
        {"y is still one load. x and z are lookups."}
      </text>
      <text x="40" y="392" fontSize="10" fontStyle="italic" fillOpacity="0.85">
        {"A layout without room for the extras word gives such an object a Structure of its own, which holds them."}
      </text>
    </svg>
  </div>
);

export const PropertyCache = () => (
  <div
    style={{
      overflowX: "auto",
      padding: "0 20px",
      WebkitMaskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
      maskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
    }}
  >
    <svg
      viewBox="0 0 720 430"
      width="100%"
      style={{ minWidth: "680px" }}
      fill="currentColor"
      fontFamily="ui-sans-serif, system-ui, sans-serif"
      role="img"
      aria-label="A read by name goes through a chain of tables: the site's own cache, the image's table of fields, the front table, the hashed table, a search, and a C++ operation that files the answer"
    >
      <rect
        x="16"
        y="16"
        width="250"
        height="76"
        rx="6"
        fill="#ec4899"
        fillOpacity="0.06"
        stroke="#ec4899"
        strokeWidth="1.2"
      />
      <text x="28" y="36" fontSize="11" fill="#ec4899" fontWeight="600">
        {"compiled code, read-only"}
      </text>
      <text x="28" y="54" fontSize="9.5" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"mov  rsi, site       ; 16 bytes of data"}
      </text>
      <text x="28" y="67" fontSize="9.5" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {'mov  r10d, 0x4d9     ; number of "vec"'}
      </text>
      <text x="28" y="80" fontSize="9.5" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"call GetByIdAtSite"}
      </text>
      <path
        d="M266 54 L294.4 54"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M300 54 L293.6 56.9 L293.6 51.1 Z" fill="currentColor" />
      <rect
        x="300"
        y="16"
        width="404"
        height="50"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.07"
        stroke="#16a34a"
        strokeWidth="1.2"
      />
      <text x="312" y="33" fontSize="11" fill="#16a34a" fontWeight="600">
        {"1  site cache"}
      </text>
      <text x="694" y="33" fontSize="9" textAnchor="end" fillOpacity="0.8">
        {"per thread, 16 bytes per hot site"}
      </text>
      <text x="312" y="52" fontSize="9.8" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"StructureID == site.StructureID ?  load [obj + site.offset]"}
      </text>
      <path
        d="M340 66 L340 74"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M340 78 L338 73.4 L342 73.4 Z" fill="currentColor" />
      <text x="348" y="76" fontSize="8.5" fontStyle="italic" fillOpacity="0.8">
        {"miss"}
      </text>
      <rect
        x="300"
        y="78"
        width="404"
        height="50"
        rx="6"
        fill="#3b82f6"
        fillOpacity="0.07"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <text x="312" y="95" fontSize="11" fill="#3b82f6" fontWeight="600">
        {"2  table of fields"}
      </text>
      <text x="694" y="95" fontSize="9" textAnchor="end" fillOpacity="0.8">
        {"in the image, read-only: compiled objects need no warm-up"}
      </text>
      <text x="312" y="114" fontSize="9.8" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"(layout, name number) -> slot and its representation"}
      </text>
      <path
        d="M340 128 L340 136"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M340 140 L338 135.4 L342 135.4 Z" fill="currentColor" />
      <text x="348" y="138" fontSize="8.5" fontStyle="italic" fillOpacity="0.8">
        {"miss"}
      </text>
      <rect
        x="300"
        y="140"
        width="404"
        height="50"
        rx="6"
        fill="#3b82f6"
        fillOpacity="0.07"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <text x="312" y="157" fontSize="11" fill="#3b82f6" fontWeight="600">
        {"3  front table"}
      </text>
      <text x="694" y="157" fontSize="9" textAnchor="end" fillOpacity="0.8">
        {"per thread: rows displaced into one array"}
      </text>
      <text x="312" y="176" fontSize="9.8" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"cell[row of Structure + name number], tag matches ?"}
      </text>
      <path
        d="M340 190 L340 198"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M340 202 L338 197.4 L342 197.4 Z" fill="currentColor" />
      <text x="348" y="200" fontSize="8.5" fontStyle="italic" fillOpacity="0.8">
        {"miss"}
      </text>
      <rect
        x="300"
        y="202"
        width="404"
        height="50"
        rx="6"
        fill="#3b82f6"
        fillOpacity="0.07"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <text x="312" y="219" fontSize="11" fill="#3b82f6" fontWeight="600">
        {"4  hashed table"}
      </text>
      <text x="694" y="219" fontSize="9" textAnchor="end" fillOpacity="0.8">
        {"per thread: for names without a column"}
      </text>
      <text x="312" y="238" fontSize="9.8" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"four ways, key = (StructureID, name)"}
      </text>
      <path
        d="M340 252 L340 260"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M340 264 L338 259.4 L342 259.4 Z" fill="currentColor" />
      <text x="348" y="262" fontSize="8.5" fontStyle="italic" fillOpacity="0.8">
        {"miss"}
      </text>
      <rect
        x="300"
        y="264"
        width="404"
        height="50"
        rx="6"
        fill="#d97706"
        fillOpacity="0.07"
        stroke="#d97706"
        strokeWidth="1.2"
      />
      <text x="312" y="281" fontSize="11" fill="#d97706" fontWeight="600">
        {"5  search"}
      </text>
      <text x="694" y="281" fontSize="9" textAnchor="end" fillOpacity="0.8">
        {"still in the stub, in assembly"}
      </text>
      <text x="312" y="300" fontSize="9.8" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"the Structure's property table, then the prototype chain"}
      </text>
      <path
        d="M340 314 L340 322"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M340 326 L338 321.4 L342 321.4 Z" fill="currentColor" />
      <text x="348" y="324" fontSize="8.5" fontStyle="italic" fillOpacity="0.8">
        {"miss"}
      </text>
      <rect
        x="300"
        y="326"
        width="404"
        height="50"
        rx="6"
        fill="#8b5cf6"
        fillOpacity="0.07"
        stroke="#8b5cf6"
        strokeWidth="1.2"
      />
      <text x="312" y="343" fontSize="11" fill="#8b5cf6" fontWeight="600">
        {"6  operation"}
      </text>
      <text x="694" y="343" fontSize="9" textAnchor="end" fillOpacity="0.8">
        {"files the answer in 1, 3 or 4"}
      </text>
      <text x="312" y="362" fontSize="9.8" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"C++: getters, proxies, exotic objects"}
      </text>
      <path
        d="M300 351 L276 351 L276 41 L290.4 41"
        fill="none"
        stroke="#8b5cf6"
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray="4 3"
      />
      <path d="M296 41 L289.6 43.9 L289.6 38.1 Z" fill="#8b5cf6" />
      <text x="268" y="240" fontSize="9.5" fill="#8b5cf6" textAnchor="end" fontStyle="italic">
        {"fill"}
      </text>
      <rect
        x="16"
        y="120"
        width="236"
        height="196"
        rx="6"
        fill="currentColor"
        fillOpacity="0.03"
        stroke="currentColor"
        strokeWidth="0.8"
      />
      <text x="28" y="140" fontSize="11" fontWeight="600">
        {"an entry says one of"}
      </text>
      <text x="28" y="158" fontSize="9.2" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"Value          at this offset of"}
      </text>
      <text x="28" y="172.5" fontSize="9.2" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"               the object or a holder"}
      </text>
      <text x="28" y="187" fontSize="9.2" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"Absent         nowhere on the chain"}
      </text>
      <text x="28" y="201.5" fontSize="9.2" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"Field          in a typed slot"}
      </text>
      <text x="28" y="216" fontSize="9.2" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"ExtraProperty  in the side object"}
      </text>
      <text x="28" y="230.5" fontSize="9.2" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"Getter         call this function"}
      </text>
      <text x="28" y="245" fontSize="9.2" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"Transition     a store adds it"}
      </text>
      <text x="28" y="272" fontSize="10" fontStyle="italic">
        {"Each kind has a handler, and the"}
      </text>
      <text x="28" y="286" fontSize="10" fontStyle="italic">
        {"stub jumps to it through a table."}
      </text>
      <text x="28" y="300" fontSize="10" fontStyle="italic">
        {"No instruction is ever rewritten."}
      </text>
      <text x="16" y="414" fontSize="10.5" fontStyle="italic">
        {"A change to an object further up a prototype chain drops the entries that were filed through it."}
      </text>
    </svg>
  </div>
);

export const ImageAndStart = () => (
  <div
    style={{
      overflowX: "auto",
      padding: "0 20px",
      WebkitMaskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
      maskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
    }}
  >
    <svg
      viewBox="0 0 720 400"
      width="100%"
      style={{ minWidth: "680px" }}
      fill="currentColor"
      fontFamily="ui-sans-serif, system-ui, sans-serif"
      role="img"
      aria-label="The parts of an executable, how each is mapped, and which of them a start touches"
    >
      <text x="16" y="22" fontSize="12" fontWeight="600">
        {"the file"}
      </text>
      <text x="300" y="22" fontSize="12" fontWeight="600">
        {"in memory"}
      </text>
      <text x="540" y="22" fontSize="12" fontWeight="600">
        {"at start"}
      </text>
      <rect
        x="16"
        y="34"
        width="250"
        height="70"
        rx="6"
        fill="#14b8a6"
        fillOpacity="0.08"
        stroke="#14b8a6"
        strokeWidth="1.2"
      />
      <text x="28" y="51" fontSize="11" fill="#14b8a6" fontWeight="600">
        {"bun's runtime"}
      </text>
      <text x="28" y="66" fontSize="9.5" fillOpacity="0.85">
        {"event loop, APIs, collector,"}
      </text>
      <text x="28" y="78.5" fontSize="9.5" fillOpacity="0.85">
        {"interpreter. Trimmed ranges"}
      </text>
      <text x="28" y="91" fontSize="9.5" fillOpacity="0.85">
        {"have no bytes"}
      </text>
      <path
        d="M266 69 L290.4 69"
        fill="none"
        stroke="#14b8a6"
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M296 69 L289.6 71.9 L289.6 66.1 Z" fill="#14b8a6" />
      <text x="300" y="72.5" fontSize="9.8">
        {"r-x / r--, file-backed, shared"}
      </text>
      <text x="540" y="72.5" fontSize="9.8" fill="#16a34a" fontWeight="600">
        {"the pages that run"}
      </text>
      <rect
        x="16"
        y="112"
        width="250"
        height="40"
        rx="6"
        fill="#3b82f6"
        fillOpacity="0.08"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <text x="28" y="129" fontSize="11" fill="#3b82f6" fontWeight="600">
        {"image header"}
      </text>
      <text x="28" y="144" fontSize="9.5" fillOpacity="0.85">
        {"sizes, a stamp, flags, section offsets"}
      </text>
      <path
        d="M266 132 L290.4 132"
        fill="none"
        stroke="#3b82f6"
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M296 132 L289.6 134.9 L289.6 129.1 Z" fill="#3b82f6" />
      <text x="300" y="135.5" fontSize="9.8">
        {"r--"}
      </text>
      <text x="540" y="135.5" fontSize="9.8" fill="#16a34a" fontWeight="600">
        {"read and checked once"}
      </text>
      <rect
        x="16"
        y="160"
        width="250"
        height="70"
        rx="6"
        fill="#3b82f6"
        fillOpacity="0.08"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <text x="28" y="177" fontSize="11" fill="#3b82f6" fontWeight="600">
        {"image tables"}
      </text>
      <text x="28" y="192" fontSize="9.5" fillOpacity="0.85">
        {"functions, frames, positions,"}
      </text>
      <text x="28" y="204.5" fontSize="9.5" fillOpacity="0.85">
        {"strings, names, layouts,"}
      </text>
      <text x="28" y="217" fontSize="9.5" fillOpacity="0.85">
        {"classes, modules"}
      </text>
      <path
        d="M266 195 L290.4 195"
        fill="none"
        stroke="#3b82f6"
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M296 195 L289.6 197.9 L289.6 192.1 Z" fill="#3b82f6" />
      <text x="300" y="198.5" fontSize="9.8">
        {"r--, file-backed, shared"}
      </text>
      <text x="540" y="198.5" fontSize="9.8" fill="#16a34a" fontWeight="600">
        {"only the rows that are asked for"}
      </text>
      <rect
        x="16"
        y="238"
        width="250"
        height="56"
        rx="6"
        fill="#3b82f6"
        fillOpacity="0.08"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <text x="28" y="255" fontSize="11" fill="#3b82f6" fontWeight="600">
        {"image code"}
      </text>
      <text x="28" y="270" fontSize="9.5" fillOpacity="0.85">
        {"functions, stubs, RegExp and"}
      </text>
      <text x="28" y="282.5" fontSize="9.5" fillOpacity="0.85">
        {"wasm code, constants"}
      </text>
      <path
        d="M266 266 L290.4 266"
        fill="none"
        stroke="#3b82f6"
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M296 266 L289.6 268.9 L289.6 263.1 Z" fill="#3b82f6" />
      <text x="300" y="269.5" fontSize="9.8">
        {"r-x, mapped again at an address of its own"}
      </text>
      <text x="540" y="269.5" fontSize="9.8" fill="#16a34a" fontWeight="600">
        {"only the pages that run"}
      </text>
      <path
        d="M16 306 L704 306"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray="2 4"
        strokeOpacity="0.5"
      />
      <rect
        x="16"
        y="316"
        width="250"
        height="50"
        rx="6"
        fill="#d97706"
        fillOpacity="0.04"
        stroke="#d97706"
        strokeWidth="1.2"
        strokeDasharray="4 3"
      />
      <text x="28" y="334" fontSize="11" fill="#d97706" fontWeight="600">
        {"not in the file"}
      </text>
      <text x="28" y="350" fontSize="9.5" fillOpacity="0.85">
        {"one per VM, so one per Worker"}
      </text>
      <rect
        x="300"
        y="316"
        width="226"
        height="50"
        rx="6"
        fill="#d97706"
        fillOpacity="0.08"
        stroke="#d97706"
        strokeWidth="1.2"
      />
      <text x="312" y="334" fontSize="11" fill="#d97706" fontWeight="600">
        {"the instance"}
      </text>
      <text x="312" y="350" fontSize="9.5">
        {"rw-, reserved, zero pages on demand"}
      </text>
      <text x="540" y="334" fontSize="9.8" fill="#16a34a" fontWeight="600">
        {"a few pages: module variables,"}
      </text>
      <text x="540" y="348" fontSize="9.8" fill="#16a34a" fontWeight="600">
        {"statics, caches as they fill"}
      </text>
      <text x="16" y="388" fontSize="10.5" fontStyle="italic">
        {
          "Nothing is parsed, interned, relocated per function or copied. No loop runs over functions, strings, classes or modules."
        }
      </text>
    </svg>
  </div>
);

export const HeapCage = () => (
  <div
    style={{
      overflowX: "auto",
      padding: "0 20px",
      WebkitMaskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
      maskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
    }}
  >
    <svg
      viewBox="0 0 720 250"
      width="100%"
      style={{ minWidth: "680px" }}
      fill="currentColor"
      fontFamily="ui-sans-serif, system-ui, sans-serif"
      role="img"
      aria-label="Cells of one VM lie in one reservation of 32 gigabytes, so a reference in a field is 32 bits: the address shifted right by three"
    >
      <rect
        x="16"
        y="40"
        width="688"
        height="46"
        rx="6"
        fill="#14b8a6"
        fillOpacity="0.06"
        stroke="#14b8a6"
        strokeWidth="1.2"
      />
      <text
        x="16"
        y="30"
        fontSize="10"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#14b8a6"
        fontWeight="600"
      >
        {"base, aligned to 32 GB, in r14 / x25"}
      </text>
      <text
        x="704"
        y="30"
        fontSize="10"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        textAnchor="end"
        fillOpacity="0.8"
      >
        {"base + 32 GB"}
      </text>
      <rect
        x="16"
        y="40"
        width="60"
        height="46"
        rx="2"
        fill="currentColor"
        fillOpacity="0.05"
        stroke="currentColor"
        strokeWidth="0.6"
        strokeDasharray="3 3"
      />
      <text x="46" y="67" fontSize="9" textAnchor="middle" fillOpacity="0.7">
        {"no cells"}
      </text>
      <rect
        x="96"
        y="46"
        width="72"
        height="34"
        rx="3"
        fill="#14b8a6"
        fillOpacity="0.12"
        stroke="#14b8a6"
        strokeWidth="1.2"
      />
      <text x="132" y="67" fontSize="8.5" textAnchor="middle">
        {"MarkedBlock"}
      </text>
      <rect
        x="176"
        y="46"
        width="72"
        height="34"
        rx="3"
        fill="#14b8a6"
        fillOpacity="0.12"
        stroke="#14b8a6"
        strokeWidth="1.2"
      />
      <text x="212" y="67" fontSize="8.5" textAnchor="middle">
        {"MarkedBlock"}
      </text>
      <rect
        x="256"
        y="46"
        width="72"
        height="34"
        rx="3"
        fill="#14b8a6"
        fillOpacity="0.12"
        stroke="#14b8a6"
        strokeWidth="1.2"
      />
      <rect
        x="336"
        y="46"
        width="72"
        height="34"
        rx="3"
        fill="#14b8a6"
        fillOpacity="0.12"
        stroke="#14b8a6"
        strokeWidth="1.2"
      />
      <text x="372" y="67" fontSize="8.5" textAnchor="middle">
        {"MarkedBlock"}
      </text>
      <text x="560" y="67" fontSize="9.5" textAnchor="middle" fontStyle="italic" fillOpacity="0.8">
        {"reserved address space, not memory"}
      </text>
      <rect
        x="280"
        y="52"
        width="22"
        height="22"
        rx="2"
        fill="#3b82f6"
        fillOpacity="0.4"
        stroke="#3b82f6"
        strokeWidth="1.2"
      />
      <path
        d="M291 120 L291 83.6"
        fill="none"
        stroke="#3b82f6"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M291 78 L293.9 84.4 L288.1 84.4 Z" fill="#3b82f6" />
      <text x="16" y="136" fontSize="10.5" fontWeight="600">
        {"address"}
      </text>
      <text x="110" y="136" fontSize="11" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"0x0000_7a18_0412_3450"}
      </text>
      <text x="330" y="136" fontSize="10" fillOpacity="0.85">
        {"a full pointer: in registers, on the stack, in a JSValue"}
      </text>
      <text x="16" y="166" fontSize="10.5" fontWeight="600">
        {"in a field"}
      </text>
      <text
        x="110"
        y="166"
        fontSize="11"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fill="#3b82f6"
        fontWeight="600"
      >
        {"0x0082_468a"}
      </text>
      <text x="330" y="166" fontSize="10" fillOpacity="0.85">
        {"Cell32 = (uint32) (address >> 3): four bytes"}
      </text>
      <text x="16" y="196" fontSize="10.5" fontWeight="600">
        {"decode"}
      </text>
      <text x="110" y="196" fontSize="11" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"lea rax, [r14 + rax*8]"}
      </text>
      <text x="330" y="196" fontSize="10" fillOpacity="0.85">
        {"or folded into the next load's address"}
      </text>
      <text x="16" y="232" fontSize="10.5" fontStyle="italic">
        {
          "The lowest indexes name no cell, so small values are free to mark absent, undefined and null in an OptionalCell32 slot."
        }
      </text>
    </svg>
  </div>
);

export const Trimming = () => (
  <div
    style={{
      overflowX: "auto",
      padding: "0 20px",
      WebkitMaskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
      maskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
    }}
  >
    <svg
      viewBox="0 0 720 392"
      width="100%"
      style={{ minWidth: "680px" }}
      fill="currentColor"
      fontFamily="ui-sans-serif, system-ui, sans-serif"
      role="img"
      aria-label="Trimming: flow finds the built-ins a program reaches, each built-in names a feature, and each feature owns page-aligned ranges of the bun binary that can be left out"
    >
      <text x="16" y="22" fontSize="11.5" fontWeight="600">
        {"your program"}
      </text>
      <text x="200" y="22" fontSize="11.5" fontWeight="600">
        {"built-ins that flow reaches"}
      </text>
      <text x="452" y="22" fontSize="11.5" fontWeight="600">
        {"features"}
      </text>
      <text x="600" y="22" fontSize="11.5" fontWeight="600">
        {"ranges of bun"}
      </text>
      <rect
        x="16"
        y="34"
        width="156"
        height="112"
        rx="6"
        fill="#ec4899"
        fillOpacity="0.06"
        stroke="#ec4899"
        strokeWidth="1.2"
      />
      <text x="26" y="56" fontSize="9.5" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"Bun.serve({ .. })"}
      </text>
      <text x="26" y="81" fontSize="9.5" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"new WebSocket(url)"}
      </text>
      <text x="26" y="106" fontSize="9.5" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"typeof Bun.sql"}
      </text>
      <text x="26" y="131" fontSize="9.5" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {'n.toLocaleString("de")'}
      </text>
      <rect
        x="200"
        y="36"
        width="226"
        height="30"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.07"
        stroke="#16a34a"
        strokeWidth="1.2"
      />
      <text x="210" y="55" fontSize="9.2" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"Bun.serve"}
      </text>
      <text x="418" y="55" fontSize="9" fill="#16a34a" textAnchor="end" fontWeight="600">
        {"Called"}
      </text>
      <rect
        x="200"
        y="74"
        width="226"
        height="30"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.07"
        stroke="#16a34a"
        strokeWidth="1.2"
      />
      <text x="210" y="93" fontSize="9.2" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"WebSocket"}
      </text>
      <text x="418" y="93" fontSize="9" fill="#16a34a" textAnchor="end" fontWeight="600">
        {"Constructed"}
      </text>
      <rect
        x="200"
        y="112"
        width="226"
        height="30"
        rx="6"
        fill="#8b5cf6"
        fillOpacity="0.07"
        stroke="#8b5cf6"
        strokeWidth="1.2"
      />
      <text x="210" y="131" fontSize="9.2" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"Bun.sql"}
      </text>
      <text x="418" y="131" fontSize="9" fill="#8b5cf6" textAnchor="end" fontWeight="600">
        {"Tested"}
      </text>
      <rect
        x="200"
        y="150"
        width="226"
        height="30"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.07"
        stroke="#16a34a"
        strokeWidth="1.2"
      />
      <text x="210" y="169" fontSize="9.2" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"Number#toLocaleString"}
      </text>
      <text x="418" y="169" fontSize="9" fill="#16a34a" textAnchor="end" fontWeight="600">
        {"Called"}
      </text>
      <rect
        x="200"
        y="212"
        width="226"
        height="30"
        rx="6"
        fill="currentColor"
        fillOpacity="0.02"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeDasharray="3 3"
      />
      <text x="210" y="231" fontSize="9.2" fontFamily="ui-monospace, Menlo, Consolas, monospace">
        {"bun:sqlite, HTMLRewriter .."}
      </text>
      <text x="418" y="231" fontSize="9" textAnchor="end" fontWeight="600">
        {"not reached"}
      </text>
      <path
        d="M172 52 L196 51.1"
        fill="none"
        stroke="#ec4899"
        strokeWidth="1"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M200 51 L195.5 53.2 L195.4 49.1 Z" fill="#ec4899" />
      <path
        d="M172 77 L196.3 87.4"
        fill="none"
        stroke="#ec4899"
        strokeWidth="1"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M200 89 L195 89.1 L196.6 85.3 Z" fill="#ec4899" />
      <path
        d="M172 102 L197 124.3"
        fill="none"
        stroke="#ec4899"
        strokeWidth="1"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M200 127 L195.2 125.5 L198 122.4 Z" fill="#ec4899" />
      <path
        d="M172 127 L197.6 161.8"
        fill="none"
        stroke="#ec4899"
        strokeWidth="1"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M200 165 L195.7 162.5 L198.9 160.1 Z" fill="#ec4899" />
      <rect
        x="452"
        y="36"
        width="124"
        height="30"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.07"
        stroke="#16a34a"
        strokeWidth="1.2"
      />
      <text x="514" y="55" fontSize="9.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" textAnchor="middle">
        {"Serve"}
      </text>
      <rect
        x="452"
        y="74"
        width="124"
        height="30"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.07"
        stroke="#16a34a"
        strokeWidth="1.2"
      />
      <text x="514" y="93" fontSize="9.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" textAnchor="middle">
        {"WebSocket"}
      </text>
      <rect
        x="452"
        y="112"
        width="124"
        height="30"
        rx="6"
        fill="#ef4444"
        fillOpacity="0.07"
        stroke="#ef4444"
        strokeWidth="1.2"
      />
      <text x="514" y="131" fontSize="9.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" textAnchor="middle">
        {"Sql"}
      </text>
      <rect
        x="452"
        y="150"
        width="124"
        height="30"
        rx="6"
        fill="#16a34a"
        fillOpacity="0.07"
        stroke="#16a34a"
        strokeWidth="1.2"
      />
      <text x="514" y="169" fontSize="9.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" textAnchor="middle">
        {"IntlNumberFormat"}
      </text>
      <rect
        x="452"
        y="212"
        width="124"
        height="30"
        rx="6"
        fill="#ef4444"
        fillOpacity="0.07"
        stroke="#ef4444"
        strokeWidth="1.2"
      />
      <text x="514" y="231" fontSize="9.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" textAnchor="middle">
        {"Sqlite, HtmlRewriter"}
      </text>
      <rect
        x="452"
        y="262"
        width="124"
        height="30"
        rx="6"
        fill="#ef4444"
        fillOpacity="0.07"
        stroke="#ef4444"
        strokeWidth="1.2"
      />
      <text x="514" y="281" fontSize="9.5" fontFamily="ui-monospace, Menlo, Consolas, monospace" textAnchor="middle">
        {"Tools, Check, JIT"}
      </text>
      <path
        d="M426 51 L448 51"
        fill="none"
        stroke="#16a34a"
        strokeWidth="1.1"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M452 51 L447.4 53 L447.4 49 Z" fill="#16a34a" />
      <path
        d="M426 89 L448 89"
        fill="none"
        stroke="#16a34a"
        strokeWidth="1.1"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M452 89 L447.4 91 L447.4 87 Z" fill="#16a34a" />
      <path
        d="M426 165 L448 165"
        fill="none"
        stroke="#16a34a"
        strokeWidth="1.1"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M452 165 L447.4 167 L447.4 163 Z" fill="#16a34a" />
      <path
        d="M426 127 L436 127"
        fill="none"
        stroke="#8b5cf6"
        strokeWidth="1.1"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray="3 3"
      />
      <path
        d="M437.5 123.5 L444.5 130.5"
        fill="none"
        stroke="#ef4444"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M437.5 130.5 L444.5 123.5"
        fill="none"
        stroke="#ef4444"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <text x="514" y="306" fontSize="8.8" textAnchor="middle" fontStyle="italic" fillOpacity="0.85">
        {"never in a compiled executable"}
      </text>
      <rect
        x="600"
        y="34"
        width="104"
        height="262"
        rx="6"
        fill="currentColor"
        fillOpacity="0.02"
        stroke="currentColor"
        strokeWidth="1"
      />
      <rect
        x="604"
        y="38"
        width="96"
        height="42"
        rx="2"
        fill="#14b8a6"
        fillOpacity="0.14"
        stroke="#14b8a6"
        strokeWidth="0.8"
      />
      <text x="652" y="62.5" fontSize="8.5" textAnchor="middle" fillOpacity="1">
        {"always needed"}
      </text>
      <rect
        x="604"
        y="84"
        width="96"
        height="24"
        rx="2"
        fill="#16a34a"
        fillOpacity="0.14"
        stroke="#16a34a"
        strokeWidth="0.8"
      />
      <text x="652" y="99.5" fontSize="8.5" textAnchor="middle" fillOpacity="1">
        {"Serve"}
      </text>
      <rect
        x="604"
        y="112"
        width="96"
        height="20"
        rx="2"
        fill="#16a34a"
        fillOpacity="0.14"
        stroke="#16a34a"
        strokeWidth="0.8"
      />
      <text x="652" y="125.5" fontSize="8.5" textAnchor="middle" fillOpacity="1">
        {"WebSocket"}
      </text>
      <rect
        x="604"
        y="136"
        width="96"
        height="26"
        rx="2"
        fill="#ef4444"
        fillOpacity="0.03"
        stroke="#ef4444"
        strokeWidth="0.8"
        strokeDasharray="3 3"
      />
      <text x="652" y="152.5" fontSize="8.5" textAnchor="middle" fillOpacity="0.65">
        {"Sql"}
      </text>
      <rect
        x="604"
        y="166"
        width="96"
        height="24"
        rx="2"
        fill="#16a34a"
        fillOpacity="0.14"
        stroke="#16a34a"
        strokeWidth="0.8"
      />
      <text x="652" y="181.5" fontSize="8.5" textAnchor="middle" fillOpacity="1">
        {"IntlNumberFormat"}
      </text>
      <rect
        x="604"
        y="194"
        width="96"
        height="30"
        rx="2"
        fill="#ef4444"
        fillOpacity="0.03"
        stroke="#ef4444"
        strokeWidth="0.8"
        strokeDasharray="3 3"
      />
      <text x="652" y="212.5" fontSize="8.5" textAnchor="middle" fillOpacity="0.65">
        {"Sqlite"}
      </text>
      <rect
        x="604"
        y="228"
        width="96"
        height="20"
        rx="2"
        fill="#ef4444"
        fillOpacity="0.03"
        stroke="#ef4444"
        strokeWidth="0.8"
        strokeDasharray="3 3"
      />
      <text x="652" y="241.5" fontSize="8.5" textAnchor="middle" fillOpacity="0.65">
        {"HtmlRewriter"}
      </text>
      <rect
        x="604"
        y="252"
        width="96"
        height="38"
        rx="2"
        fill="#ef4444"
        fillOpacity="0.03"
        stroke="#ef4444"
        strokeWidth="0.8"
        strokeDasharray="3 3"
      />
      <text x="652" y="274.5" fontSize="8.5" textAnchor="middle" fillOpacity="0.65">
        {"Tools, Check, JIT"}
      </text>
      <text x="652" y="310" fontSize="8.8" textAnchor="middle" fontStyle="italic">
        {"page-aligned, fixed"}
      </text>
      <text x="652" y="321" fontSize="8.8" textAnchor="middle" fontStyle="italic">
        {"when bun is linked"}
      </text>
      <text x="16" y="338" fontSize="10.2" fontStyle="italic">
        {"Dashed ranges get no bytes in the file and are not mapped. What stays keeps its address."}
      </text>
      <text x="16" y="355" fontSize="10.2" fontStyle="italic">
        {
          "A test is no use: Bun.sql is still a property, and typeof answers as before. A call of it throws ERR_FEATURE_REMOVED."
        }
      </text>
      <text x="16" y="372" fontSize="10.2" fontStyle="italic">
        {
          "Which sections belong to a feature is read from the relocations of bun's own object files: C++, C and Rust alike."
        }
      </text>
    </svg>
  </div>
);
