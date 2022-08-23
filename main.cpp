#include <arpa/inet.h>
#include <ifaddrs.h>
#include <stdio.h>
#include <netdb.h>
#include "interface_addresses.h"

int main()
{
    NetworkInterface* arr = getNetworkInterfaces();
    int arrLength = getNetworkInterfaceArrayLen(arr);

    char** arr2 = getNetworkInterfaceNames();
    int arrLength2 = getNetworkInterfaceNameArrayLen(arr2);

    for (int i = 0; i < arrLength; i++) {
        printf("Interface: %s | Address: %s | Family: %s | Netmask: %s | Mac: %s | Internal %s\n", arr[i].interface, arr[i].address, arr[i].family, arr[i].netmask, arr[i].mac, arr[i].internal ? "true" : "false");
    }

    for (int i = 0; i < arrLength2; i++) {
        printf("%s \n", arr2[i]);
    }

    return 0;
}
