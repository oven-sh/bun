<script setup lang="ts">
const props = defineProps<{ error: { statusCode: number; statusMessage?: string } }>();
</script>
<template><p>our own page for errors: {{ props.error.statusCode }} {{ props.error.statusMessage }}</p></template>
