import * as anthropicEnvironments from "@anthropic-ai/sdk/helpers/beta/environments";
import * as anthropicBetaJsonSchema from "@anthropic-ai/sdk/helpers/beta/json-schema";
import * as anthropicMcp from "@anthropic-ai/sdk/helpers/beta/mcp";
import * as anthropicMemory from "@anthropic-ai/sdk/helpers/beta/memory";
import * as anthropicStandardSchema from "@anthropic-ai/sdk/helpers/beta/standard-schema";
import * as anthropicToolsets from "@anthropic-ai/sdk/helpers/beta/toolsets";
import * as anthropicBetaZod from "@anthropic-ai/sdk/helpers/beta/zod";
import * as anthropicJsonSchema from "@anthropic-ai/sdk/helpers/json-schema";
import * as anthropicZod from "@anthropic-ai/sdk/helpers/zod";
import * as openaiAudio from "openai/helpers/audio";
import * as openaiBrowser from "openai/helpers/browser";
import * as openaiComputer from "openai/helpers/computer";
import * as openaiDecisions from "openai/helpers/decisions-tool-runner";
import * as openaiLive from "openai/helpers/live";
import * as openaiResponses from "openai/helpers/responses-tool-runner";
import * as openaiStandardSchema from "openai/helpers/standard-schema";
import * as openaiZod from "openai/helpers/zod";
import * as openaiZodStrict from "openai/helpers/zod-v3-strict-schema";

const modules: Record<string, Record<string, unknown>> = {
  anthropicEnvironments,
  anthropicBetaJsonSchema,
  anthropicMcp,
  anthropicMemory,
  anthropicStandardSchema,
  anthropicToolsets,
  anthropicBetaZod,
  anthropicJsonSchema,
  anthropicZod,
  openaiAudio,
  openaiBrowser,
  openaiComputer,
  openaiDecisions,
  openaiLive,
  openaiResponses,
  openaiStandardSchema,
  openaiZod,
  openaiZodStrict,
};
for (const [name, module] of Object.entries(modules))
  console.log(
    name + ":",
    Object.keys(module)
      .sort()
      .map(key => {
        const value = module[key];
        return `${key}=${typeof value === "function" ? (/^class\s/.test(Function.prototype.toString.call(value)) ? "class" : "function") + "/" + value.length : Array.isArray(value) ? "array/" + value.length : typeof value}`;
      })
      .join(" "),
  );
