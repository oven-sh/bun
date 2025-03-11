import { test, expect } from "bun:test";
import { VirtualModuleService } from "./facade";
import { parse } from "@vue/compiler-sfc";

test("VirtualModuleService", () => {
    const App = /* vue */ `
<script setup lang="ts">
defineProps<{
msg: string
}>()
</script>

<template>
<main class="hello">
    Oh hi there, {{ msg }}!
</main>
</template>
<style>
.hello {
    color: red;
}
</style>
`.trim();
    const service = new VirtualModuleService("/usr/bun")
    const component = parse(App, { filename: "/usr/bun/App.vue" });
    expect(component.errors).toBeEmpty();
    const actual = service.registerSFC(component.descriptor);
    
});
