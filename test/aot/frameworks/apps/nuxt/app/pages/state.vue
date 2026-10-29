<script setup lang="ts">
const visits = useVisits();
visits.value++;
const who = useCookie("who");
const fresh = useCookie("fresh", { path: "/" });
fresh.value = "set while rendering";
const { $shout } = useNuxtApp();
</script>
<template><p>visits {{ visits }}, cookie {{ who ?? "none" }}, {{ $shout("provided by a plugin") }}</p></template>
